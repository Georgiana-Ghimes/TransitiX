import { describe, expect, it } from 'vitest';
import { parseBaumitAviz, normalizePlate, repairAvizFromStored, avizFieldConfidence, fieldConfidenceForUi, isFalseRoute, isSuspiciousRoute, quantityConflictsWithRaw } from './avizOcr.js';
import { mapAnnexRows, DEFAULT_RAI_COLUMNS, resolveExportColumns } from './avizTemplate.js';

const PSL_FIXTURE = `
SC FURNIZOR DEMO SRL
Aviz de expeditie: PSL-26031501
Comanda de transport: TPO-00112233
Data avizului de expeditie: 15.03.2026
Placuta de inmatriculare: B 330 SRS
Expeditor Site: BOL Bolintin str. Republicii nr. IF Bolintin-Deal
Adresa de livrare: CS-DEMO Strada Independentei nr. 121 Domnesti RO 077000
Client: C23000014 AP-DEMO Strada Aeroportului nr. 120-T Bucuresti Sector 1 RO 013596
Cantitate: 245 sac
`;

const TRO_FIXTURE = `
Aviz rezumat: TPO-00990011
Aviz de expeditie: TRO-26040201
Data avizului de expeditie: 02.04.2026
Placuta de inmatriculare: B-112-XYZ
Depozit: MIL Militari
Transfer intern
12 pal
`;

const ZONA_B_FIXTURE = `
Aviz de expeditie: PSL-26032099
Comanda de transport: TPO-00445566
Data avizului de expeditie: 20.03.2026
Placuta de inmatriculare: IL 10 ABC
Site: BOL Bolintin
Livrare zona centrala B
80 buc
`;

describe('normalizePlate', () => {
  it('normalizes spaced Romanian plates', () => {
    expect(normalizePlate('B 330 SRS')).toBe('B-330-SRS');
  });

  it('keeps tractor and trailer plates', () => {
    expect(normalizePlate('B 112 VFM / B 475AGR')).toBe('B-112-VFM / B-475-AGR');
  });

  it('does not treat document prose as a plate', () => {
    expect(normalizePlate('DOCUMENT DE TEST BUILDTEST MATERIALE DEMONSTRATIVE PENTRU PLATFORMA DE TEST')).toBeNull();
  });

  it('rejects partial plate + OCR noise (ClickUp Numar auto)', () => {
    expect(normalizePlate('330 SRS FOOTY STREAM TRANSPORTATOR')).toBeNull();
    expect(normalizePlate('330 SR5 FOOTY STREAM TRANSPORTATOR')).toBeNull();
  });
});

const BAUMIT_TABLE_FIXTURE = `
Aviz de expeditie
PSL-0044362
Data avizului de expeditie
10.08.2026
Comanda vanzare SOR-0046409
Comanda de transport
11000149 MPI 25 40 kg (35/pal)
245.00 sac
7.00 pal
Adresa de livrare STR CIRESULUI NR 31B
Placuta de inmatriculare B 330 SRS
Site BOL Bolintin
TPO-0025629
`;

describe('parseBaumitAviz', () => {
  it('parses PSL sales layout (TPO, aviz, plate, date, sac qty)', () => {
    const parsed = parseBaumitAviz(PSL_FIXTURE);
    expect(parsed.numar_tpo).toBe('TPO-00112233');
    expect(parsed.numar_document_marfa).toBe('PSL-26031501');
    expect(parsed.data_efectuare_cursa).toBe('2026-03-15');
    expect(parsed.numar_auto).toBe('B-330-SRS');
    expect(parsed.tip_marfa).toBe('saci');
    expect(parsed.cantitate_marfa).toBe(245);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Str. Independentei nr. 121, Domnesti');
    expect(parsed.layout).toBe('psl');
    expect(parsed.numar_curse).toBe(1);
    expect(parsed.valoare_tpo).toBe(0);
    expect(parsed.observatii).toBeNull();
  });

  it('parses TRO transfer layout', () => {
    const parsed = parseBaumitAviz(TRO_FIXTURE);
    expect(parsed.numar_tpo).toBe('TPO-00990011');
    expect(parsed.numar_document_marfa).toBe('TRO-26040201');
    expect(parsed.data_efectuare_cursa).toBe('2026-04-02');
    expect(parsed.numar_auto).toBe('B-112-XYZ');
    expect(parsed.tip_marfa).toBe('paleti');
    expect(parsed.cantitate_marfa).toBe(12);
    expect(parsed.ruta_transport).toBeNull();
    expect(parsed.layout).toBe('tro');
  });

  it('does not auto-fill Observatii from zona centrala text', () => {
    const parsed = parseBaumitAviz(ZONA_B_FIXTURE);
    expect(parsed.numar_document_marfa).toBe('PSL-26032099');
    expect(parsed.tip_marfa).toBe('bucati');
    expect(parsed.cantitate_marfa).toBe(80);
    expect(parsed.observatii).toBeNull();
  });

  it('keeps Numar TPO as TPO-digits, not product names like MPI or Adeziv', () => {
    const parsed = parseBaumitAviz(BAUMIT_TABLE_FIXTURE);
    expect(parsed.numar_tpo).toBe('TPO-0025629');
    expect(parsed.numar_tpo).not.toMatch(/MPI|Adeziv|Adresa/i);
    expect(parsed.numar_document_marfa).toBe('PSL-0044362');
    expect(parsed.cantitate_marfa).toBe(245);
    expect(parsed.tip_marfa).toBe('saci');
  });

  it('rejects glued OCR bag counts that exceed a truck load', () => {
    const parsed = parseBaumitAviz('AVIZ DE INSOTIRE\nCantitate 245090 saci\nAuto B 123 ABC');
    expect(parsed.cantitate_marfa).toBeNull();
    expect(parsed.tip_marfa).toBeNull();
  });

  it('reads TPO from word-per-line PDF text instead of the next product word', () => {
    const raw = `
Comandă
de
transport
TPO-0025629
MPI
25
40
kg
Aviz
de
expeditie:
PSL-0044362
Placuta
de
inmatriculare
B
330
SRS
Site:
BOL
Bolintin
Adresă
de
livrare
STR
CIRESULUI
Dobroești
RO
077085
245.00
sac
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.numar_tpo).toBe('TPO-0025629');
    expect(parsed.numar_document_marfa).toBe('PSL-0044362');
    expect(parsed.numar_auto).toBe('B-330-SRS');
    expect(parsed.cantitate_marfa).toBe(245);
    // Fixture has no house number on the delivery lines.
    expect(parsed.ruta_transport).toBe('Str. Ciresului, Dobroesti');
  });

  it('keeps nr. and locality when Adresa de livrare shares a row with Referința client', () => {
    // Rezumat Baumit: heading row is two columns; OCR concatenates them. Stopping at
    // Referința client used to leave only "Str. Republicii".
    const raw = `
Expeditor
Site: MIL
Depozit: NEAMTIU
Aviz de expeditie rezumat: TPO-0031027
Adresa de livrare    Referinta client
MD MARFA BOL Bolintin
Str. Republicii, nr. 1F
Bolintin-Deal RO 087015 ROU
Termen de livrare
Cod UIT
Num de comanda de transport TPO-0031027
Placuta de inmatriculare B 911 VFM / B 138 VRT
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('MIL-NEAMTIU / Str. Republicii nr. 1F, Bolintin-Deal');
  });

  it('uses Site+Depozit as origin when Expeditor has no street', () => {
    const raw = `
Expeditor
Site: MIL-
Depozit: NEAMTIU
Adresa de livrare
Str. Republicii, nr. 1F
Bolintin-Deal RO 087015 ROU
Termen de livrare
Placuta de inmatriculare B 911 VFM
TPO-0031027
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('MIL-NEAMTIU / Str. Republicii nr. 1F, Bolintin-Deal');
  });

  it('keeps nr. + locality when Referința client is glued after the street name', () => {
    // Real OCR sometimes emits the right-column header mid-address, after Str. …
    const raw = `
Expeditor
Site: MIL
Depozit: NEAMTIU
Adresa de livrare
Str. Republicii Referinta client
nr. 1F
Bolintin-Deal RO 087015 ROU
Termen de livrare
Placuta de inmatriculare B 911 VFM
TPO-0031027
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('MIL-NEAMTIU / Str. Republicii nr. 1F, Bolintin-Deal');
  });

  it('does not copy the delivery street into Expeditor on one-line OCR', () => {
    const raw = 'Expeditor Site: MIL- Depozit: NEAMTIU Adresa de livrare Referinta client BOL MBMARFA Bolintin Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU Termen de livrare Placuta de inmatriculare B 911 VFM TPO-0031027';
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('MIL-NEAMTIU / Str. Republicii nr. 1F, Bolintin-Deal');
  });

  it('keeps IF + Bolintin-Deal when pdf-parse tabs house/locality into the next cell', () => {
    // Real text layer from TPO-0031027 rezumat (before sanitize collapses tabs).
    const raw = `
Expeditor
Site	MIL .
NEAMTIU	Pagina
Depozit
Aviz de expediție rezumat: TPO-0031027
Adresa de livrare
BOL MBMARFA Bolintin
str. Republicii,	IF Bolintin-Deal RO 087015 ROU
nr.
Transportator RAI.SPEDITION SRL
Placuta de inmatriculare B 911 VFM / B 138 VRT
Termeni de livrare DAP
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('MIL-NEAMTIU / Str. Republicii nr. 1F, Bolintin-Deal');
  });

  it('rebuilds Adresa de livrare from Baumit two-column tab OCR (not Client)', () => {
    const raw = `
Expeditor
Site: BOL Bolintin
Str. Republicii,	IF Bolintin-Deal RO 087015 ROU
nr.
Adresă de livrare	Client
CS-DEMOS-OBI CIRESULUI	C23901185 DEMOS INTERMED SRL
STR	NR 31B	Locotenent Moga Nr. 18
CIRESULUI,
RO	Fundeni RO 077086
Dobroești	077085
ROU	ROU
Client factură:	C23901185 DEMOS INTERMED SRL
Comandă de transport TPO-0025629
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Str. Ciresului nr. 31B, Dobroesti');
    expect(parsed.ruta_transport).not.toMatch(/Fundeni|Locotenent|Moga|Aeroportului/i);
  });

  it('keeps the street name when the type sits alone left of a tab (Sosea\\tViilor)', () => {
    // pdf-parse often splits "Șosea Viilor nr. 52" so the type is one cell and the name the
    // next. Treating every right cell as Client produced route legs of just "Șosea".
    const raw = `
Expeditor
Site: BOL Bolintin
Str. Republicii, nr. 1F
Bolintin-Deal
RO 087015
Adresă de livrare	Client
CS-CONCELEX- OBI LOHN	C23901527 CONCELEX SRL
Sosea	Viilor nr. 52
Bucuresti	050151
Client factură:	C23901527 CONCELEX SRL
Placuta de inmatriculare B 34 BAU
TPO-0025803
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti');
    expect(parsed.ruta_transport).not.toMatch(/\/ Șosea,/);
    expect(parsed.delivery_address).toMatchObject({
      locality: 'Bucuresti', streetName: 'viilor', streetType: 'sosea', houseNumber: '52',
    });
  });

  it('rebuilds Șosea Viilor when tab OCR puts name+house above the type (client original)', () => {
    // Real Baumit two-column extract: name and number land one row above "Șosea\tnr.",
    // while the Client street (Aeroportului) sits in the right cells.
    const raw = `
Expeditor
Site: BOL Bolintin
Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU
Adresă de livrare	Client
CS-CONCELEX- OBI LOHN	C23000014 AP-CONCELEX- OBI LOHN
Viilor	52	Stradă Aeroportului nr. 120-T
Șosea	nr.
5 RO	București Sector 1 RO 013596
București Sector	050151
ROU	ROU
Client factură:	C23901527 CONCELEX SRL
Placuta de inmatriculare B 34 BAU
TPO-0025803
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti');
    expect(parsed.ruta_transport).not.toMatch(/Aeroportului/i);
    expect(parsed.delivery_address).toMatchObject({
      locality: 'Bucuresti', streetName: 'viilor', streetType: 'sosea', houseNumber: '52',
    });
  });

  it('does not emit a bare street type as the delivery leg', () => {
    const raw = `
Expeditor Str. Republicii nr. 1F Bolintin-Deal RO 087015
Adresa de livrare Sosea Bucuresti Sector 5 RO 050151
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Bucuresti');
    expect(parsed.ruta_transport).not.toMatch(/Șosea/);
  });

  it('does not emit a house number without a street name', () => {
    const raw = `
Expeditor Str. Republicii nr. 1F Bolintin-Deal RO 087015
Adresa de livrare	Client
Sosea	nr. 52
Bucuresti	050151
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Bucuresti');
    expect(parsed.ruta_transport).not.toMatch(/\bnr\.\s*52\b/);
    expect(parsed.delivery_address?.streetName).toBeFalsy();
  });

  it('reads house-then-name after the type (nr. before the street word)', () => {
    const raw = `
Expeditor Str. Republicii nr. 1F Bolintin-Deal RO 087015
Adresa de livrare Sosea nr. 52 Viilor Bucuresti Sector 5 RO 050151
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti');
  });

  it('replaces a stored Client-column delivery leg with Adresa de livrare from raw OCR', () => {
    const raw = `
Expeditor
Site: BOL Bolintin
Str. Republicii, nr. 1F Bolintin-Deal RO 087015 ROU
Adresă de livrare	Client
CS-DEMOS-OBI CIRESULUI	C23901185 DEMOS INTERMED SRL
STR	NR 31B	Locotenent Moga Nr. 18
CIRESULUI,
RO	Fundeni RO 077086
Dobroești	077085
ROU	ROU
Client factură:	C23901185 DEMOS INTERMED SRL
`;
    const repaired = repairAvizFromStored({
      ruta_transport: 'Str. Republicii, Bolintin-Deal / Str. Locotenent Moga, Fundeni',
      extracted_data: { raw_text: raw },
    });
    expect(repaired.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Str. Ciresului nr. 31B, Dobroesti');
    expect(repaired.ruta_transport).not.toMatch(/Locotenent|Fundeni/i);
  });

  it('reads 11.08.2026 13:10 as 11 August, not 1 August', () => {
    const raw = `
Data
aviz
de
expeditie
Aviz
rezumat:
TPO-0025813
Adresa
de
livrare
Militari
11.08.2026
13:10
Placuta
de
inmatriculare
B
112
VFM
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.data_efectuare_cursa).toBe('2026-08-11');
    expect(parsed.numar_tpo).toBe('TPO-0025813');
  });

  it('strips PDF "PAGINA" footers and does not take the Client AP- street as delivery', () => {
    const raw = `
Expeditor
Site: BOL Bolintin
Str. Republicii, nr. 1F
Bolintin-Deal
RO 087015
ROU
PAGINA 1/1
Aviz de expeditie: PSL-0044633
Adresă de livrare
CS-CONCELEX- OBI LOHN
Sosea Viilor nr. 52
Bucuresti Sector 5 RO 050151
ROU
Client factură: C23901527 CONCELEX SRL
C23000014 AP-CONCELEX- OBI LOHN Stradă Aeroportului nr. 120-T București Sector 1 RO 013596 ROU
Placuta de inmatriculare B 34 BAU
TPO-0025803
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti');
    expect(parsed.ruta_transport).not.toMatch(/pagina|aeroportului/i);
  });

  it('unsticks a glued RepubliciiPAGINA OCR token', () => {
    const raw = `
Expeditor Site: BOL Bolintin Str. RepubliciiPAGINA nr. 1F Bolintin-Deal RO 087015
Adresa de livrare Sosea Viilor nr. 52 Bucuresti Sector 5 RO 050151
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toMatch(/Republicii/i);
    expect(parsed.ruta_transport).not.toMatch(/pagina/i);
  });

  it('builds the route from Expeditor street + Adresa de livrare (PSL-0044633 layout)', () => {
    // Real Baumit PDF: Site BOL is a label; the load address is Str. Republicii / Bolintin-Deal.
    const raw = `
Expeditor
Site: BOL Bolintin
Str. Republicii, nr. 1F
Bolintin-Deal
RO 087015
ROU
Aviz de expeditie: PSL-0044633
Adresă de livrare
CS-CONCELEX- OBI LOHN
Sosea Viilor nr. 52
Bucuresti Sector 5 RO 050151
ROU
Client factură: C23901527 CONCELEX SRL
Placuta de inmatriculare B 34 BAU
TPO-0025803
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti');
    expect(parsed.ruta_transport).not.toBe('Bol');
    expect(parsed.ruta_transport).not.toMatch(/^Bol-/);
    expect(parsed.delivery_address).toMatchObject({
      locality: 'Bucuresti', streetName: 'viilor', houseNumber: '52',
    });
  });

  it('reads any town from the labelled blocks, not from a hard-coded list', () => {
    const raw = `
Expeditor
Site: XYZ Depou
Strada Luncii nr. 3
Fagetel-Nord
RO 123456
Aviz de expeditie: PSL-99990001
Adresa de livrare
SC CLIENT SRL
Aleea Castanilor nr. 8
Campina RO 105600
Placuta de inmatriculare B 11 XYZ
TPO-00990001
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Luncii nr. 3, Fagetel-Nord / Aleea Castanilor nr. 8, Campina');
    expect(parsed.ruta_transport).not.toMatch(/Bol|Mil|XYZ/i);
  });

  it('starts the route at the Expeditor site, not at a customer address', () => {
    const raw = `
Expeditor Site: BOL Bolintin str. Republicii nr. IF Bolintin-Deal RO 087015
Aviz de expeditie: PSL-0044633
Adresă de livrare CS-CONCELEX- OBI LOHN Șosea Viilor nr. 52 București Sector 5 RO 050151 ROU
Client factură: C23901527 CONCELEX SRL
C23000014 AP-CONCELEX- OBI LOHN Stradă Aeroportului nr. 120-T București Sector 1 RO 013596 ROU
Placuta de inmatriculare B 34 BAU / B 34 BAU
TPO-0025803
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti');
    // Origin is the street under Expeditor, not the Site code "BOL".
    expect(parsed.ruta_transport).toMatch(/Republicii/i);
    expect(parsed.ruta_transport).toMatch(/Bolintin-Deal/i);
    // Aeroportului 120-T is a second address belonging to the buyer. Starting the route there
    // described a journey between two of the customer's own premises that no lorry made.
    expect(parsed.ruta_transport).not.toMatch(/Aeroportului/i);
    expect(parsed.numar_auto).toBe('B-34-BAU');
    // The same block, kept apart from the route code, is what the zone fee is read from.
    // "Viilor52" cannot be looked up in a street index; "viilor" plus "52" can.
    expect(parsed.delivery_address).toMatchObject({
      locality: 'Bucuresti', streetName: 'viilor', streetType: 'sosea', houseNumber: '52',
    });
  });

  it('takes destination only from Adresa de livrare and origin only from Expeditor', () => {
    const raw = `
Expeditor Site: BOL Bolintin str. Republicii nr. IF Bolintin-Deal RO 087015
Adresa de livrare CS-DEMO Aleea Teilor nr. 5 Domnesti RO 077000
Client: C23000014 AP-DEMO Stradă Aeroportului nr. 120 Bucuresti Sector 1 RO 013596
Placuta de inmatriculare B 111 ABC
TPO-00110011
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Aleea Teilor nr. 5, Domnesti');
    expect(parsed.ruta_transport).not.toMatch(/Aeroportului/i);
  });

  it('does not invent an origin from the Client block when Expeditor is missing', () => {
    const raw = `
Adresa de livrare CS-DEMO Aleea Teilor nr. 5 Domnesti RO 077000
Client: C23000014 AP-DEMO Stradă Aeroportului nr. 120 Bucuresti Sector 1 RO 013596
Placuta de inmatriculare B 111 ABC
TPO-00110011
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Aleea Teilor nr. 5, Domnesti');
    expect(parsed.ruta_transport).not.toMatch(/Aeroportului/i);
  });

  it('ignores MIL printed inside Adresa de livrare when Expeditor is BOL', () => {
    const raw = `
Expeditor Site: BOL Bolintin str. Republicii
Adresa de livrare MIL NEAMTIU Militari Bvd. Iuliu Maniu, nr. 600A Bucuresti Sector 6 RO 061129
Placuta de inmatriculare B 112 VFM
TPO-0025813
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii / Bvd. Iuliu Maniu nr. 600A, Bucuresti');
    expect(parsed.ruta_transport).not.toMatch(/^Mil-/i);
  });

  it('ignores the client billing address, which no lorry ever visits', () => {
    const raw = `
Expeditor Site: BOL Bolintin
Adresă de livrare CS-DEMOS-OBI CIRESULUI STR CIRESULUI, NR 31B Dobroești RO 077085
Client factură: C23901185 DEMOS INTERMED SRL
1008c-Dobroesti/0762563838
C23901185 DEMOS INTERMED SRL Locotenent Moga Nr. 18 Fundeni RO 077086 ROU
Placuta de inmatriculare B 330 SRS
TPO-0025629
PSL-0044362
`;
    const parsed = parseBaumitAviz(raw);
    // Site BOL, no street under Expeditor → BOL / delivery (not the Client factură seat).
    expect(parsed.ruta_transport).toBe('BOL / Str. Ciresului nr. 31B, Dobroesti');
    expect(parsed.numar_auto).toBe('B-330-SRS');
  });

  it('parses Blvd, Aleea and Piata street types on the delivery leg', () => {
    const raw = `
Expeditor Site: BOL Bolintin str. Republicii nr. IF Bolintin-Deal
Aviz de expeditie: PSL-26080101
Adresa de livrare CS-DEMO Aleea Teilor nr. 5 Domnesti RO 077000
Client: C23000014 AP-DEMO Blvd Unirii nr. 10 Bucuresti Sector 3 RO 030000
Placuta de inmatriculare B 111 ABC
TPO-00110011
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Aleea Teilor nr. 5, Domnesti');
    // "Aleea Teilor" is read as a street type plus a name, which is what this case is about.
    expect(parsed.ruta_transport).toMatch(/Teilor/i);
    // Blvd Unirii is the buyer's registered address, not a stop on this run.
    expect(parsed.ruta_transport).not.toMatch(/Unirii/i);
  });

  it('parses Pta / Piata abbreviations', () => {
    const raw = `
Aviz de expeditie: PSL-26080201
Adresa de livrare CS-DEMO Pta Unirii nr. 1 Bucuresti Sector 4 RO 040000
Client: C23000015 AP-DEMO Piata Victoriei nr. 2 Bucuresti Sector 1 RO 010000
Placuta de inmatriculare B 222 DEF
TPO-00110022
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toMatch(/Victoriei|Unirii/i);
  });

  it('reads two plates including glued trailer B 475AGR', () => {
    const raw = `
Expeditor Site Depozit MIL MMMARFA
Adresa de livrare MIL NEAMTIU Militari Bvd. Iuliu Maniu, nr. 600A Bucuresti Sector 6 RO 061129 ROU
Placuta de inmatriculare B 112 VFM / B 475AGR
TPO-0025813
Aviz de expeditie TRO-0008053
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.numar_auto).toBe('B-112-VFM / B-475-AGR');
    expect(parsed.ruta_transport).toBe('MIL-MMMARFA / Bvd. Iuliu Maniu nr. 600A, Bucuresti');
    expect(parsed.ruta_transport).not.toMatch(/Bolintin/i);
    // A two-word street name survives the split, glued only in the route code.
    expect(parsed.delivery_address).toMatchObject({
      locality: 'Bucuresti', streetName: 'iuliu maniu', houseNumber: '600A',
    });
  });

  it('reads NUMAR AUTO from synthetic test avize instead of dumping the PDF text', () => {
    const raw = `
DOCUMENT DE TEST BUILDTEST Materiale demonstrative pentru platforma de test
AVIZ DE EXPEDITIE TEST-AVZ-000102 EXEMPLU SINTETIC - FARA VALOARE COMERCIALA
ADRESA DE LIVRARE RENOVARE DEMO S.R.L. Calea Laboratorului nr. 18, Cluj-Napoca, RO 400512
DATA AVIZULUI 20.08.2026
NUMAR AUTO TEST-102
NUME DELEGAT Ionescu Mara
1 Tencuiala 240.00 sac
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.numar_auto).toBe('TEST-102');
    expect(parsed.numar_auto.length).toBeLessThan(40);
    expect(parsed.numar_document_marfa).toBe('TEST-AVZ-000102');
    expect(parsed.data_efectuare_cursa).toBe('2026-08-20');
  });

  it('reads two synthetic NUMAR AUTO values', () => {
    const raw = `
COMANDA TRANSPORT TPO-0025843-TEST
AVIZ DE EXPEDITIE TRO-0008097-TEST
NUMAR AUTO B TEST 43 / B TEST 44
NUME DELEGAT Dumitru Costin
768.00 buc
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.numar_tpo).toBe('TPO-0025843');
    expect(parsed.numar_auto).toBe('B TEST 43 / B TEST 44');
    expect(parsed.numar_document_marfa).toBe('TRO-0008097');
  });

  it('leaves Numar auto empty when OCR dumps bookmark text onto a partial plate', () => {
    const raw = `
Aviz de expeditie PSL-0044362
Placuta de inmatriculare 330 SRS FOOTY STREAM TRANSPORTATOR
245.00 sac
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.numar_auto).toBeNull();
    expect(parsed.numar_document_marfa).toBe('PSL-0044362');
  });
});

describe('repairAvizFromStored', () => {
  it('replaces MPI with TPO from stored raw_text', () => {
    const repaired = repairAvizFromStored({
      numar_tpo: 'MPI',
      extracted_data: { raw_text: 'Comanda de transport TPO-0024665 MPI 25 kg PSL-0042718' },
    });
    expect(repaired.numar_tpo).toBe('TPO-0024665');
  });

  it('keeps the whole TPO number when it carries a year and a sequence', () => {
    // `TPO 2026-0311` used to normalise to `TPO-2026`, so every trip of that year shared one
    // number: a report showed the same identifier on every line and flagged them as duplicates.
    expect(repairAvizFromStored({ numar_tpo: 'TPO 2026-0311' }).numar_tpo).toBe('TPO-2026-0311');
    expect(repairAvizFromStored({ numar_tpo: 'TPO 2026-0312' }).numar_tpo).toBe('TPO-2026-0312');
  });

  it('still normalises the plain Baumit form', () => {
    expect(repairAvizFromStored({ numar_tpo: 'TPO 0025803' }).numar_tpo).toBe('TPO-0025803');
  });

  it('normalises a handwritten slash form TPO / #####', () => {
    expect(repairAvizFromStored({ numar_tpo: 'TPO / 31027' }).numar_tpo).toBe('TPO-31027');
    expect(repairAvizFromStored({ numar_tpo: 'TPO/31027' }).numar_tpo).toBe('TPO-31027');
  });

  it('keeps an office-edited date instead of the PDF date', () => {
    const repaired = repairAvizFromStored({
      numar_tpo: 'TPO-0025813',
      data_efectuare_cursa: '2026-08-21',
      extracted_data: {
        raw_text: 'Data aviz de expeditie TPO-0025813 11.08.2026 13:10',
      },
    });
    expect(repaired.data_efectuare_cursa).toBe('2026-08-21');
  });

  it('fills date from raw_text when the saved date is empty', () => {
    const repaired = repairAvizFromStored({
      data_efectuare_cursa: null,
      extracted_data: {
        raw_text: 'Data aviz de expeditie TPO-0025813 11.08.2026 13:10',
      },
    });
    expect(repaired.data_efectuare_cursa).toBe('2026-08-11');
  });

  it('upgrades a glued annex route from raw OCR instead of keeping it', () => {
    const repaired = repairAvizFromStored({
      numar_tpo: 'TPO-0025803',
      ruta_transport: 'Bol-Bucuresti/Viilor52',
      extracted_data: {
        raw_text: `Expeditor Site: BOL Bolintin str. Republicii nr. 1F Bolintin-Deal RO 087015
Adresă de livrare CS-CONCELEX Șosea Viilor nr. 52 București Sector 5 RO 050151
Client C23000014 AP-CONCELEX Stradă Aeroportului nr. 120-T București Sector 1 RO 013596
TPO-0025803`,
      },
    });
    expect(repaired.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti');
    expect(repaired.delivery_address?.streetName).toBe('viilor');
  });

  it('upgrades truncated Site/Depozit route with full delivery street from OCR', () => {
    const repaired = repairAvizFromStored({
      numar_tpo: 'TPO-0031027',
      ruta_transport: 'MIL-NEAMTIU / Str. Republicii',
      extracted_data: {
        raw_text: `Expeditor
Site: MIL-
Depozit: NEAMTIU
Adresa de livrare    Referinta client
BOL MBMARFA Bolintin
Str. Republicii, nr. 1F
Bolintin-Deal RO 087015 ROU
Termen de livrare
Placuta de inmatriculare B 911 VFM
TPO-0031027`,
      },
    });
    expect(repaired.ruta_transport).toBe('MIL-NEAMTIU / Str. Republicii nr. 1F, Bolintin-Deal');
  });

  it('keeps a spaced office-edited route when ruta_transport is in corrected_fields', () => {
    const repaired = repairAvizFromStored({
      numar_tpo: 'TPO-0025803',
      ruta_transport: 'Str. Custom, Oras / Str. Alta, Oras',
      corrected_fields: ['ruta_transport'],
      extracted_data: {
        raw_text: `Expeditor Site: BOL Bolintin str. Republicii nr. 1F Bolintin-Deal RO 087015
Adresă de livrare CS-CONCELEX Șosea Viilor nr. 52 București Sector 5 RO 050151
Client C23000014 AP-CONCELEX Stradă Aeroportului nr. 120-T București Sector 1 RO 013596
TPO-0025803`,
      },
    });
    expect(repaired.ruta_transport).toBe('Str. Custom, Oras / Str. Alta, Oras');
  });

  it('replaces a false Bolintin-Deal route with Site→livrare from the stored OCR text', () => {
    // Ticket 35: OCR profile treated the Expeditor town as City-City; export kept it because
    // preferStored never overwrites a non-empty field.
    expect(isFalseRoute('Bolintin-Deal')).toBe(true);
    expect(isFalseRoute('Bol-Dobroesti/Ciresului31B')).toBe(false);

    const repaired = repairAvizFromStored({
      numar_tpo: 'TPO-0025629',
      ruta_transport: 'Bolintin-Deal',
      extracted_data: {
        raw_text: `Expeditor Site: BOL Bolintin str. Republicii nr. IF Bolintin-Deal RO 087015
Adresă de livrare CS-DEMOS-OBI CIRESULUI STR CIRESULUI, NR 31B Dobroești RO 077085
Client factură: C23901185 DEMOS INTERMED SRL
Placuta de inmatriculare B 330 SRS
TPO-0025629
PSL-0044362`,
      },
    });
    expect(repaired.ruta_transport).toBe('Str. Republicii nr. 1F, Bolintin-Deal / Str. Ciresului nr. 31B, Dobroesti');
    expect(repaired.ruta_transport).toMatch(/Republicii|Ciresului/i);
    expect(repaired.delivery_address?.locality).toBe('Dobroesti');
  });

  it('keeps an office-edited plate and document number', () => {
    const repaired = repairAvizFromStored({
      numar_auto: 'B-999-XYZ',
      numar_document_marfa: 'PSL-1111111',
      extracted_data: {
        raw_text: 'Placuta de inmatriculare B 112 VFM / B 475AGR Aviz de expeditie PSL-0044633 TPO-0025803',
      },
    });
    expect(repaired.numar_auto).toBe('B-999-XYZ');
    expect(repaired.numar_document_marfa).toBe('PSL-1111111');
  });

  it('clears dumped document text from numar_auto', () => {
    const repaired = repairAvizFromStored({
      numar_auto: 'DOCUMENT DE TEST BUILDTEST MATERIALE DEMONSTRATIVE',
      extracted_data: {
        raw_text: `DOCUMENT DE TEST BUILDTEST
AVIZ DE EXPEDITIE TEST-AVZ-000102
DATA AVIZULUI 20.08.2026
NUMAR AUTO TEST-102
NUME DELEGAT Ionescu Mara
245.00 sac`,
      },
    });
    expect(repaired.numar_auto).toBe('TEST-102');
    expect(repaired.numar_document_marfa).toBe('TEST-AVZ-000102');
    expect(repaired.numar_auto).not.toMatch(/DOCUMENT DE TEST/i);
  });

  it('clears FOOTY STREAM noise from numar_auto instead of exporting it', () => {
    const repaired = repairAvizFromStored({
      numar_auto: '330 SR5 FOOTY STREAM TRANSPORTATOR',
      extracted_data: {
        raw_text: `Aviz de expeditie PSL-0044362
Placuta de inmatriculare 330 SR5 FOOTY STREAM TRANSPORTATOR
245.00 sac`,
      },
    });
    expect(repaired.numar_auto).toBeNull();
  });

  it('replaces FOOTY STREAM noise when the PDF still has a real plate', () => {
    const repaired = repairAvizFromStored({
      numar_auto: '330 SRS FOOTY STREAM TRANSPORTATOR',
      extracted_data: {
        raw_text: 'Placuta de inmatriculare B 330 SRS Aviz de expeditie PSL-0044362',
      },
    });
    expect(repaired.numar_auto).toBe('B-330-SRS');
  });

  it('keeps a TPO typed in Editează when the PDF has none', () => {
    const repaired = repairAvizFromStored({
      numar_tpo: 'TPO-00990011',
      extracted_data: {
        raw_text: `DOCUMENT DE TEST BUILDTEST
AVIZ DE EXPEDITIE TEST-AVZ-000101
NUMAR AUTO TEST-101
245.00 sac`,
      },
    });
    expect(repaired.numar_tpo).toBe('TPO-00990011');
  });

  it('keeps a short manual TPO that is not four digits', () => {
    const repaired = repairAvizFromStored({
      numar_tpo: 'TPO-12',
      extracted_data: { raw_text: 'AVIZ DE EXPEDITIE TEST-AVZ-000101 245.00 sac' },
    });
    expect(repaired.numar_tpo).toBe('TPO-12');
  });

  it('clears an impossible stored bag count so the field can be reviewed', () => {
    const repaired = repairAvizFromStored({
      tip_marfa: 'saci',
      cantitate_marfa: 245090,
      extracted_data: { raw_text: 'AVIZ Cantitate 245090 saci' },
    });
    expect(repaired.cantitate_marfa).toBeNull();
    expect(avizFieldConfidence(repaired).cantitate_marfa).toBe('low');
  });

  it('upgrades a stored bucati tip from Numarul de galeti in raw_text', () => {
    // Rows extracted before the packaging-aware tip still have tip_marfa / quantity_unit =
    // bucati. List and export must re-read the stored OCR, not wait for a re-scan.
    const repaired = repairAvizFromStored({
      tip_marfa: 'bucati',
      quantity_unit: 'buc',
      cantitate_marfa: 768,
      extracted_data: {
        raw_text: 'Cantitate 768.00 buc BetonKontakt 20 kg Numarul de galeti 768.00',
      },
    });
    expect(repaired.tip_marfa).toBe('galeti');
  });

  it('upgrades a first-line quantity when Numarul de galeti is in raw_text', () => {
    const lines = [48, 48, 72, 48, 24, 72, 48, 48, 48, 72, 48]
      .map((n) => `Cantitate ${n}.00 buc`)
      .join('\n');
    const repaired = repairAvizFromStored({
      tip_marfa: 'galeti',
      quantity_unit: 'buc',
      cantitate_marfa: 48,
      extracted_data: {
        raw_text: `${lines}\nNumarul de galeti: 576,00`,
      },
    });
    expect(repaired.cantitate_marfa).toBe(576);
    expect(repaired.tip_marfa).toBe('galeti');
  });

  it('keeps an office-edited packaging tip over a weaker parse', () => {
    const repaired = repairAvizFromStored({
      tip_marfa: 'galeti',
      quantity_unit: 'bucati',
      extracted_data: { raw_text: 'Cantitate 768.00 buc' },
    });
    expect(repaired.tip_marfa).toBe('galeti');
  });

  it('fills tip from quantity_unit when raw_text has no packaging word', () => {
    const repaired = repairAvizFromStored({
      tip_marfa: 'bucati',
      quantity_unit: 'saci',
      extracted_data: { raw_text: 'Cantitate 245 buc' },
    });
    expect(repaired.tip_marfa).toBe('saci');
  });
});

describe('review heuristics (#41)', () => {
  it('flags glued street+number routes without locality as suspicious', () => {
    expect(isSuspiciousRoute('Republicii17')).toBe(true);
    expect(isSuspiciousRoute('Bol')).toBe(true);
    expect(isSuspiciousRoute('BolintinDeal/Republicii1F-Bucuresti/Viilor52')).toBe(true);
    expect(isSuspiciousRoute('MIL-NEAMTIU / Str. Republicii nr. 1F, Bolintin-Deal')).toBe(false);
    expect(isFalseRoute('MIL-NEAMTIU')).toBe(true);
    expect(isSuspiciousRoute('Str. Republicii nr. 1F, Bolintin-Deal / Șosea Viilor nr. 52, Bucuresti')).toBe(false);
    expect(isSuspiciousRoute('Str. Republicii nr. 1F, Bolintin-Deal')).toBe(false);
    expect(avizFieldConfidence({ ruta_transport: 'Republicii17' }).ruta_transport).toBe('low');
  });

  it('flags quantity that disagrees with Numărul de găleți in raw text', () => {
    const lines = [48, 48, 72, 48, 24, 72, 48, 48, 48, 72, 48]
      .map((n) => `Cantitate ${n}.00 buc`)
      .join('\n');
    const raw = `${lines}\nNumarul de galeti: 576,00`;
    expect(quantityConflictsWithRaw(48, 'galeti', raw)).toBe(true);
    expect(avizFieldConfidence({
      cantitate_marfa: 48,
      tip_marfa: 'galeti',
      extracted_data: { raw_text: raw },
    }).cantitate_marfa).toBe('low');
  });

  it('does not let a stored ok confidence hide a heuristic low', () => {
    const ui = fieldConfidenceForUi({
      ruta_transport: 'Republicii17',
      cantitate_marfa: 48,
      tip_marfa: 'galeti',
      field_confidence: {
        ruta_transport: 'ok',
        cantitate_marfa: { status: 'ok', confidence: 0.95 },
      },
      extracted_data: {
        raw_text: 'Cantitate 48.00 buc\nCantitate 72.00 buc\nNumarul de galeti: 576,00',
      },
    });
    expect(ui.ruta_transport).toBe('low');
    expect(ui.cantitate_marfa).toBe('low');
  });
});

describe('mapAnnexRows', () => {
  it('fills sequential nr_crt and unknown source from default', () => {
    const rows = mapAnnexRows(
      [
        { key: 'nr_crt', header: 'Nr. Crt.', source: 'nr_crt' },
        { key: 'numar_tpo', header: 'Numar TPO', source: 'numar_tpo' },
        { key: 'extra', header: 'Extra', source: 'not_a_field', default_value: 'IF*' },
      ],
      [{ numar_tpo: 'TPO-1' }, { numar_tpo: 'TPO-2' }]
    );
    expect(rows[0].nr_crt).toBe(1);
    expect(rows[1].nr_crt).toBe(2);
    expect(rows[0].numar_tpo).toBe('TPO-1');
    expect(rows[0].extra).toBe('IF*');
  });

  it('uses RAI default column set', () => {
    expect(DEFAULT_RAI_COLUMNS).toHaveLength(14);
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [{ numar_tpo: 'TPO-9', numar_curse: 1 }]);
    expect(mapped[0].nr_crt).toBe(1);
    expect(mapped[0].valoare_tpo).toBe(0);
    expect(mapped[0].numar_curse).toBe(1);
  });

  it('exports Numar curse as distinct runs per TPO, not always 1', () => {
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [
      {
        numar_tpo: 'TPO-9',
        data_efectuare_cursa: '2026-09-10',
        numar_auto: 'B-111-AAA',
        numar_curse: 1,
      },
      {
        numar_tpo: 'TPO-9',
        data_efectuare_cursa: '2026-09-10',
        numar_auto: 'B-222-BBB',
        numar_curse: 1,
      },
    ]);
    expect(mapped[0].numar_curse).toBe(2);
    expect(mapped[1].numar_curse).toBe(2);
  });

  it('fills Tip marfa from quantity_unit when tip is empty', () => {
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [{
      numar_tpo: 'TPO-1',
      cantitate_marfa: 245,
      tip_marfa: null,
      quantity_unit: 'saci',
    }]);
    expect(mapped[0].tip_marfa).toBe('saci');
  });

  it('prefers packaging unit over empty tip even when unit is galeți', () => {
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [{
      cantitate_marfa: 768,
      tip_marfa: '',
      quantity_unit: 'galeți',
    }]);
    expect(mapped[0].tip_marfa).toBe('galeti');
  });

  it('puts quantity_unit into Tip marfa even when tip holds a product name', () => {
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [{
      tip_marfa: 'MPI Adeziv',
      quantity_unit: 'saci',
      cantitate_marfa: 245,
    }]);
    expect(mapped[0].tip_marfa).toBe('saci');
  });

  it('keeps an edited packaging tip over a stale bucati quantity_unit', () => {
    // Screen shows galeti after Editează / re-extract; quantity_unit often still holds the
    // bare "buc" from Cantitate … buc. The annex must not put that count word back.
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [{
      tip_marfa: 'galeti',
      quantity_unit: 'bucati',
      cantitate_marfa: 768,
    }]);
    expect(mapped[0].tip_marfa).toBe('galeti');
  });

  it('does not write bucati onto Tip marfa from quantity_unit alone', () => {
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [{
      tip_marfa: null,
      quantity_unit: 'buc',
      cantitate_marfa: 768,
    }]);
    expect(mapped[0].tip_marfa).toBe('');
  });

  it('puts weighbridge tons into Cantitate when greutate brută is present', () => {
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [{
      numar_tpo: 'TPO-1',
      cantitate_marfa: 245,
      tip_marfa: 'saci',
      gross_weight_kg: 9964.15,
    }]);
    expect(mapped[0].cantitate_marfa).toBe(9.96);
  });

  it('never uses greutate netă for Cantitate tonnage', () => {
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [{
      numar_tpo: 'TPO-1',
      cantitate_marfa: 245,
      tip_marfa: 'saci',
      net_weight_kg: 8200,
      gross_weight_kg: null,
    }]);
    expect(mapped[0].cantitate_marfa).toBe('');
  });

  it('keeps each cursă of one TPO on its own row, with its own route', () => {
    // TPO-0025803 driven twice: two avize, two days, two destinations. One row per cursă is
    // what the customer's sheet wants, and Numar curse says 2 on both so the pair reads as one
    // order rather than as two orders that happen to share a number.
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [
      {
        numar_tpo: 'TPO-0025803', numar_document_marfa: 'PSL-0044633',
        data_efectuare_cursa: '2026-08-10', numar_auto: 'B-34-BAU',
        ruta_transport: 'Bol-Bucuresti/Viilor52', gross_weight_kg: 15744,
      },
      {
        numar_tpo: 'TPO-0025803', numar_document_marfa: 'PSL-0044701',
        data_efectuare_cursa: '2026-08-11', numar_auto: 'B-34-BAU',
        ruta_transport: 'Bol-Bucuresti/IuliuManiu600A', gross_weight_kg: 12300,
      },
    ]);
    expect(mapped).toHaveLength(2);
    expect(mapped.map((r) => r.ruta_transport))
      .toEqual(['Bol-Bucuresti/Viilor52', 'Bol-Bucuresti/IuliuManiu600A']);
    expect(mapped.map((r) => r.numar_curse)).toEqual([2, 2]);
    expect(mapped.map((r) => r.cantitate_marfa)).toEqual([15.74, 12.3]);
  });

  it('leaves Cantitate empty when there is no greutate brută', () => {
    // The header says tone. 768 galeti is not 768 tonnes, and once that number is in the cell
    // nobody downstream can tell it from a real weight, so the column stays empty and
    // `missing_quantity_weight` names the document instead.
    const mapped = mapAnnexRows(DEFAULT_RAI_COLUMNS, [{
      numar_tpo: 'TPO-1',
      cantitate_marfa: 768,
      tip_marfa: 'galeti',
    }]);
    expect(mapped[0].cantitate_marfa).toBe('');
  });

  it('applies template Default for tax and tarif when the aviz still has 0', () => {
    const columns = DEFAULT_RAI_COLUMNS.map((col) => {
      if (col.source === 'taxe_suplimentare') return { ...col, default_value: '100' };
      if (col.source === 'tarif_km') return { ...col, default_value: '20' };
      return col;
    });
    const mapped = mapAnnexRows(columns, [{
      numar_tpo: 'TPO-1',
      taxe_suplimentare: 0,
      tarif_km: 0,
      km_parcursi: 0,
    }]);
    expect(mapped[0].taxe_suplimentare).toBe(100);
    expect(mapped[0].tarif_km).toBe(20);
    expect(mapped[0].km_parcursi).toBe(0);
  });

  it('keeps a per-aviz tax when it is not zero', () => {
    const columns = DEFAULT_RAI_COLUMNS.map((col) => (
      col.source === 'taxe_suplimentare' ? { ...col, default_value: '100' } : col
    ));
    const mapped = mapAnnexRows(columns, [{ taxe_suplimentare: 40 }]);
    expect(mapped[0].taxe_suplimentare).toBe(40);
  });

  it('keeps a custom template that is missing Nr. crt instead of replacing it', () => {
    const custom = [
      { header: 'Taxa suplimentara', source: 'taxe_suplimentare', default_value: '100' },
      { header: 'Tarif km', source: 'tarif_km', default_value: '20' },
    ];
    const cols = resolveExportColumns({ columns: custom });
    expect(cols).toHaveLength(2);
    expect(cols[0].default_value).toBe('100');
    const mapped = mapAnnexRows(cols, [{ taxe_suplimentare: 0, tarif_km: 0 }]);
    expect(mapped[0].taxe_suplimentare).toBe(100);
    expect(mapped[0].tarif_km).toBe(20);
  });
});
