import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { parseBaumitAviz, normalizePlate, repairAvizFromStored, extractAvizFromFile } from './avizOcr.js';
import { mapAnnexRows, DEFAULT_RAI_COLUMNS, resolveExportColumns } from './avizTemplate.js';
import { uploadRoot } from '../uploadPath.js';

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
    expect(parsed.ruta_transport).toBe('Bucuresti/Aeroportului120-T-Domnesti/Independentei121');
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
    expect(parsed.ruta_transport).toMatch(/^Mil/i);
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
    expect(parsed.ruta_transport).toBe('Bol-Dobroesti/Ciresului');
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

  it('builds Ruta transport from Client start to Adresa de livrare end', () => {
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
    expect(parsed.ruta_transport).toBe('Bucuresti/Aeroportului120-T-Bucuresti/Viilor52');
    expect(parsed.ruta_transport).not.toMatch(/Bolintin/i);
    expect(parsed.ruta_transport).not.toMatch(/^Bol-/);
    expect(parsed.numar_auto).toBe('B-34-BAU');
  });

  it('uses Client Locotenent street as start when delivery is Ciresului', () => {
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
    expect(parsed.ruta_transport).toBe('Fundeni/LocotenentMoga18-Dobroesti/Ciresului31B');
    expect(parsed.numar_auto).toBe('B-330-SRS');
  });

  it('parses Blvd, Aleea and Piata street types into Client to Livrare route', () => {
    const raw = `
Expeditor Site: BOL Bolintin str. Republicii nr. IF Bolintin-Deal
Aviz de expeditie: PSL-26080101
Adresa de livrare CS-DEMO Aleea Teilor nr. 5 Domnesti RO 077000
Client: C23000014 AP-DEMO Blvd Unirii nr. 10 Bucuresti Sector 3 RO 030000
Placuta de inmatriculare B 111 ABC
TPO-00110011
`;
    const parsed = parseBaumitAviz(raw);
    expect(parsed.ruta_transport).toMatch(/Unirii/i);
    expect(parsed.ruta_transport).toMatch(/Teilor/i);
    expect(parsed.ruta_transport).not.toMatch(/Bolintin/i);
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
    expect(parsed.ruta_transport).toBe('Mil-Bucuresti/IuliuManiu600A');
    expect(parsed.ruta_transport).not.toMatch(/Bolintin/i);
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
});

describe('repairAvizFromStored', () => {
  it('replaces MPI with TPO from stored raw_text', () => {
    const repaired = repairAvizFromStored({
      numar_tpo: 'MPI',
      extracted_data: { raw_text: 'Comanda de transport TPO-0024665 MPI 25 kg PSL-0042718' },
    });
    expect(repaired.numar_tpo).toBe('TPO-0024665');
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

  it('keeps an office-edited route instead of re-parsing the PDF', () => {
    const repaired = repairAvizFromStored({
      numar_tpo: 'TPO-0025803',
      ruta_transport: 'Bucuresti/Aeroportului120-T-Bucuresti/Viilor52',
      extracted_data: {
        raw_text: `Expeditor Site: BOL Bolintin str. Republicii Bolintin-Deal
Adresă de livrare CS-CONCELEX Șosea Viilor nr. 52 București Sector 5 RO 050151
Client C23000014 AP-CONCELEX Stradă Aeroportului nr. 120-T București Sector 1 RO 013596
TPO-0025803`,
      },
    });
    expect(repaired.ruta_transport).toBe('Bucuresti/Aeroportului120-T-Bucuresti/Viilor52');
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

const localTest002 = (() => {
  try {
    const names = fs.readdirSync(uploadRoot).filter((f) => f.endsWith('Aviz_test_002.pdf'));
    return names.length ? names[names.length - 1] : null;
  } catch {
    return null;
  }
})();

describe('extractAvizFromFile pdf-parse retry', () => {
  it.skipIf(!localTest002)('reads the same BUILDTEST PDF repeatedly without stubbing', async () => {
    const url = `/uploads/${localTest002}`;
    for (let i = 0; i < 6; i += 1) {
      const extracted = await extractAvizFromFile(url);
      expect(extracted._stub).toBe(false);
      expect(extracted.numar_auto).toBe('TEST-102');
      expect(extracted.numar_document_marfa).toBe('TEST-AVZ-000102');
      expect(extracted.data_efectuare_cursa).toBe('2026-08-20');
    }
  });
});
