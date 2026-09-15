/**
 * The office guide: what a person at a desk needs in order to trust what leaves the building.
 *
 * Written as reference, not as a tour. The tour introduces the screens once; this answers the
 * question somebody has at 16:40 with a customer on the phone, which is almost always "why is
 * this cell empty" or "why is it warning me about that". So every section that describes a
 * rule also says what the rule protects against, because a rule without a reason gets worked
 * around the first time it is inconvenient.
 *
 * Sections are split by profile. The RAI companion has five screens and describing the full
 * TMS to somebody who cannot see it is worse than saying nothing.
 */
import { note, p, steps, terms, warn } from './schema.js';

const FLUX = {
  id: 'flux',
  title: 'Fluxul de zi cu zi',
  lead: 'De la hârtia primită de la șantier până la fișierul trimis clientului.',
  blocks: [
    steps([
      'Șoferul fotografiază avizul din cabină, sau tu încarci PDF-ul în Avize / Rapoarte.',
      'Aplicația citește documentul (OCR) și completează ce recunoaște: TPO, data cursei, numărul auto, ruta, tipul mărfii, numărul avizului și greutatea brută.',
      'Deschizi Editează pe fiecare rând, verifici ce a citit și completezi restul: km, tarif, valoare TPO, observații.',
      'Rândul primește statusul Confirmat când l-ai verificat.',
      'Bifezi rândurile confirmate și apeși Unește în Anexa XLSX. Fișierul are exact coloanele din șablon.',
    ]),
    p('Nimic nu pleacă automat. Programul citește și propune, tu confirmi. Asta e deliberat: un aviz prost fotografiat produce cifre plauzibile, iar o cifră plauzibilă și greșită e mai scumpă decât o casetă goală.'),
  ],
};

const INCARCARE = {
  id: 'incarcare',
  title: 'Cum încarci un aviz',
  blocks: [
    p('Accepți PDF sau poză. Un PDF cu mai multe pagini e împărțit automat, fiecare pagină devine rândul ei.'),
    terms([
      { term: 'Limită per fișier', text: '15 MB. Peste asta aplicația îți spune înainte să pornească încărcarea, nu după.' },
      { term: 'Câte odată', text: 'Până la 8 fișiere într-o încărcare. Limita vine de la server și e afișată pe ecran.' },
      { term: 'De la șofer', text: 'Documentele trimise din aplicația de telefon intră în aceeași listă, marcate ca venite de la șofer, și sună clopoțelul.' },
    ]),
    note('O poză neclară e semnalată înainte de trimitere. Merită refăcută pe loc: OCR-ul pe o poză mișcată nu greșește vizibil, greșește o cifră.'),
  ],
};

const OCR = {
  id: 'ocr',
  title: 'Ce citește OCR-ul și ce nu',
  lead: 'Ce poți lăsa în seama programului și ce trebuie oricum scris de mână.',
  blocks: [
    terms([
      { term: 'Număr TPO', text: 'Citit de pe document. E numărul comenzii, și după el se grupează cursele.' },
      { term: 'Data efectuării cursei', text: 'Citită de pe aviz.' },
      { term: 'Număr auto', text: 'Citit și normalizat la forma B-12-FSR. Când avizul are și remorca, apar ambele, tractorul primul.' },
      { term: 'Ruta', text: 'Construită din situl de încărcare (BOL, MIL) și din adresa de livrare de pe document.' },
      { term: 'Tip marfă', text: 'Ambalajul de pe aviz: saci, găleți, paleți. Nu scrie niciodată „bucăți”, care nu spune nimic.' },
      { term: 'Număr document marfă', text: 'Numărul avizului (PSL, TRO). Tot el deosebește o cursă nouă de o încărcare repetată.' },
      { term: 'Greutate brută', text: 'Citită când documentul o tipărește. Vezi secțiunea despre greutate, e câmpul cu cele mai multe consecințe.' },
    ]),
    p('Nu sunt citite și le completezi tu: valoarea TPO, km parcurși, tariful pe km, taxele suplimentare și observațiile. Nu apar pe avizul de expediție, deci nu are de unde să le ia.'),
    warn('Câmpurile pe care parserul nu e sigur apar cu marginea galbenă și textul „verifică”. Nu e o eroare, e o recunoaștere sinceră că nu poate garanta ce a citit.'),
  ],
};

const GREUTATE = {
  id: 'greutate',
  title: 'Greutatea brută, și de ce coloana Cantitate rămâne goală fără ea',
  lead: 'Coloana „Cantitate marfa (tone)” din Excel are un antet care spune tone. Doar tone intră în ea.',
  blocks: [
    p('Greutatea brută e cât cântărea ansamblul la cântar în ziua aceea. Din ea se calculează cantitatea în tone pentru anexă: 15.744 kg devine 15,74.'),
    p('Când avizul nu tipărește greutatea brută, celula rămâne goală, iar documentul apare în avertismentul „Cantitate (tone) goală” cu numele lui. Înainte se scria acolo numărul de saci, deci o coloană cu antetul „(tone)” conținea 378 lângă 21,00: de douăzeci de ori mai mare, evident pentru cine se uită, invizibil pentru cine adună.'),
    warn('Greutatea netă nu ține locul celei brute niciodată. Sunt mărimi diferite, iar o valoare aproximativă într-o coloană de facturare e mai rea decât un gol pe care cineva îl observă.'),
    p('Poți scrie greutatea de mână în Editează aviz. Când o scrii, taxa de zonă se recalculează pe loc.'),
  ],
};

const EDITARE = {
  id: 'editare',
  title: 'Editează aviz, câmp cu câmp',
  blocks: [
    terms([
      { term: 'Valoare TPO', text: 'Valoarea comenzii. Rămâne 0 dacă nu o completezi, iar 0 înseamnă necompletat, nu gratis.' },
      { term: 'Număr curse', text: 'Calculat, nu scris. Vezi secțiunea despre un TPO cu mai multe curse.' },
      { term: 'Taxe suplimentare', text: 'Aici intră taxa de zonă București, completată automat. Orice altceva (macara, staționare) scrii tu. Dacă ai scris deja o sumă, programul nu o înlocuiește singur.' },
      { term: 'Km parcurși și Tarif km', text: 'Le completezi tu. Tariful e un tarif, nu se însumează pe raport.' },
      { term: 'Observații', text: 'Text liber. Butoanele cu coduri de sub câmp adaugă prescurtările folosite des.' },
      { term: 'Rută birou', text: 'Note pentru tine. Nu ajunge în Excel.' },
      { term: 'Cursă', text: 'Leagă avizul de o cursă existentă, când lucrezi și cu modulul de curse. Poți salva și fără.' },
    ]),
  ],
};

const TAXA_ZONA = {
  id: 'taxa-zona',
  title: 'Taxa de zonă București',
  lead: 'Se calculează singură în Editează aviz și intră în Taxe suplimentare, de unde ajunge în Excel.',
  blocks: [
    p('Trei lucruri trebuie să fie adevărate ca să apară o sumă: avizul are greutate brută citită, adresa de livrare se rezolvă într-o zonă, iar mașina are MTMA completat în Autoturisme.'),
    terms([
      { term: 'Zona decide adresa', text: 'Strada de livrare de pe aviz e căutată într-un index de străzi livrat cu aplicația. Nimic nu pleacă spre internet, adresele clienților rămân la tine.' },
      { term: 'Prețul decide MTMA', text: 'Masa maximă autorizată din cartea mașinii, nu cât era încărcată. Primăria taxează autorizația după MTMA, deci un camion plecat pe jumătate gol plătește tot tariful lui.' },
      { term: 'Brută peste MTMA', text: 'Dacă avizul arată mai mult decât MTMA din registru, nu se taxează nimic și primești avertisment: un camion nu poate cântări mai mult decât masa lui autorizată, deci MTMA e greșit.' },
      { term: 'Sub prag', text: 'Zona A e restricționată peste 5 t MTMA, zona B peste 7,5 t. Sub prag nu e nevoie de autorizație, deci suma e 0, dar îți arată ce tarif ar fi fost listat pentru intervalul acela.' },
    ]),
    p('Tarifele sunt cele din HCGMB 514/2025, în vigoare de la 01.01.2026, pe intervale de MTMA: 5 la 7,5 t, 7,5 la 12,5 t, 12,5 la 16 t, 16 la 22 t, 22 la 40 t și peste 40 t.'),
    note('Se taxează capătul de livrare. Capătul de încărcare apare pe aviz ca un cod de sit (BOL, MIL), nu ca o stradă, deci un camion care pleacă din depozitul Militari nu e taxat pentru drumul acela.'),
  ],
};

const AUTOTURISME = {
  id: 'autoturisme',
  title: 'Autoturisme',
  lead: 'Registrul mașinilor. Un singur câmp contează pentru bani: MTMA.',
  blocks: [
    p('Când OCR-ul citește un număr de înmatriculare pe care nu îl are, mașina se adaugă singură aici, cu MTMA gol. Tu îl completezi o dată, din cartea de identitate a vehiculului.'),
    steps([
      'Deschizi Autoturisme din meniul lateral.',
      'Mașinile fără MTMA sunt semnalate, iar clopoțelul îți amintește cât timp rămân așa.',
      'Scrii MTMA. Poți scrie 19000 sau 19, valorile sub 1000 sunt citite ca tone.',
      'După salvare câmpul rămâne blocat. Creionul de lângă el îl deblochează, ca să nu se schimbe din greșeală.',
    ]),
    p('Poți adăuga mașini și manual, înainte să vină primul aviz, ca flota să fie completă din prima zi.'),
    warn('Fără MTMA nu se calculează nicio taxă de zonă pentru mașina aceea. Nu se ghicește un tonaj, fiindcă intervalul greșit se plătește lună de lună.'),
  ],
};

const HARTA = {
  id: 'harta',
  title: 'Harta zonelor',
  blocks: [
    p('Arată zonele A și B ale Bucureștiului, desenate după perimetrele oficiale. Zona A e decupată din zona B, ca să se vadă că sunt regimuri diferite, nu una peste alta.'),
    p('Câmpul de căutare primește o stradă și un număr de înmatriculare. Îți spune în ce zonă cade adresa și ce tarif iese pentru mașina aceea, luând MTMA din Autoturisme. Dacă mașina nu are MTMA, îți spune asta și îți dă link direct.'),
    terms([
      { term: 'Strada nu e în index', text: 'Nu înseamnă „în afara zonelor”. Înseamnă că nu avem scrierea aceea. Verifică pe hartă.' },
      { term: 'Adresa nu decide singură', text: 'Unele străzi sunt tăiate de graniță, deci numărul contează. Când numărul lipsește sau cade între două intervale care nu sunt de acord, întreabă în loc să ghicească.' },
      { term: 'Mai multe străzi cu același nume', text: 'Bucureștiul are Intrarea, Șoseaua și Strada Viilor, iar ele nu sunt în aceeași zonă. Când documentul nu spune tipul, alegi tu.' },
    ]),
  ],
};

const TPO_CURSE = {
  id: 'tpo-curse',
  title: 'Un TPO cu mai multe curse',
  lead: 'O comandă poate fi transportată de mai multe ori. Asta nu e o dublură.',
  blocks: [
    p('Același TPO poate avea două avize, în două zile, către două adrese. Fiecare rămâne rândul lui în Excel, cu ruta lui, iar coloana Numar curse arată 2 pe amândouă.'),
    terms([
      { term: 'Cursă nouă', text: 'Alt număr de aviz (PSL, TRO). Alt transport, chiar dacă TPO-ul e același.' },
      { term: 'Duplicat adevărat', text: 'Același număr de aviz încărcat de două ori. Asta primește eticheta și avertismentul, fiindcă ar factura de două ori același drum.' },
      { term: 'Fără număr de aviz', text: 'Când OCR-ul nu l-a citit, se compară ziua, mașina și destinația. Două rânduri identice pe toate trei sunt tratate ca duplicat.' },
    ]),
    note('Eticheta nu blochează nimic. La Confirmă sau la export primești o întrebare, și poți merge mai departe. Pentru o încărcare greșită, folosește Șterge.'),
  ],
};

const SABLOANE = {
  id: 'sabloane',
  title: 'Șabloane și exportul XLSX',
  blocks: [
    p('Un șablon spune ce coloane are fișierul și în ce ordine. Anexa Factura RAI e blocată: are cele 14 coloane cerute de client și nu poate fi modificată, ca două firme pe aceeași versiune să nu trimită două fișiere diferite.'),
    p('Coloanele ei, în ordine: Nr. Crt., Numar TPO, Data efectuare cursa, Valoare TPO, Numar auto, Ruta transport, Tip marfa, Cantitate marfa (tone), Numar document marfa, Numar curse, Taxe suplimentare, Km parcursi, Tarif Km, Observatii.'),
    terms([
      { term: 'Valoarea Default', text: 'Se scrie în Excel doar când câmpul de pe aviz e gol, sau 0 la câmpurile unde 0 înseamnă necompletat.' },
      { term: 'Șablon fără coloane', text: 'Exportul se oprește cu un mesaj, în loc să inventeze alt aranjament. Un fișier care ignoră șablonul ales arată exact ca unul corect.' },
    ]),
  ],
};

const AVERTISMENTE = {
  id: 'avertismente',
  title: 'Avertismentele dinaintea exportului',
  lead: 'Niciunul nu blochează fișierul. Există ca alegerea de a trimite un raport incomplet să fie a ta, nu a programului.',
  blocks: [
    terms([
      { term: 'Documente neconfirmate', text: 'Rânduri pe care nu le-a verificat nimeni ajung în fișier.' },
      { term: 'Câmpuri neverificate', text: 'Valori puse de OCR pe care nu le-a controlat un operator.' },
      { term: 'Fără număr TPO', text: 'Raportul are coloana, documentul nu are numărul.' },
      { term: 'Fără dată de cursă', text: 'La fel, pentru data efectuării.' },
      { term: 'Fără dată de facturare', text: 'O poți completa pentru toată selecția deodată, din câmpul de deasupra tabelului.' },
      { term: 'Cantitate (tone) goală', text: 'Documentele fără greutate brută. Celula rămâne goală pe ele.' },
      { term: 'Fără greutate brută', text: 'Șablonul are coloană de greutate, documentul nu are valoarea.' },
      { term: 'Greutatea nu ajunge în raport', text: 'Documentele au greutate, dar șablonul ales nu o exportă, deci fișierul nu se poate verifica față de bonul de cântar.' },
      { term: 'Aviz duplicat', text: 'Același transport apare de două ori în selecție.' },
    ]),
  ],
};

const UTILIZATORI = {
  id: 'utilizatori',
  title: 'Utilizatori și roluri',
  blocks: [
    terms([
      { term: 'Admin', text: 'Vede tot, inclusiv utilizatorii și setările. Singurul care poate adăuga oameni.' },
      { term: 'Dispecer', text: 'Lucrează cu avizele și cu rapoartele, fără administrarea conturilor.' },
      { term: 'Financiar', text: 'Aceeași zonă de lucru, orientată pe facturare.' },
      { term: 'Șofer', text: 'Nu intră în birou deloc. Are aplicația lui pe telefon, cu încărcarea documentelor și profilul.' },
    ]),
    p('Un șofer care deschide adresa de birou e trimis automat în aplicația lui. Nu e o restricție de afișare, rutele de birou nu îi sunt deschise.'),
  ],
};

const PROBLEME = {
  id: 'probleme',
  title: 'Probleme frecvente',
  blocks: [
    terms([
      { term: 'Ruta e goală în tabel dar corectă în Excel', text: 'Nu se mai întâmplă. Lista și exportul repară acum documentul în același fel, tocmai pentru că un ecran care contrazice fișierul produs nu mai poate fi crezut nici când are dreptate.' },
      { term: 'Tip marfă scrie „bucăți”', text: 'Nu mai ajunge în fișier. Dacă vezi totuși un ambalaj greșit, scrie-l în Editează, valoarea ta nu e suprascrisă de OCR.' },
      { term: 'Taxa de zonă nu apare', text: 'Panoul din Editează aviz spune exact ce lipsește: greutatea, adresa, mașina sau MTMA, cu link către locul unde se rezolvă.' },
      { term: 'Un aviz apare ca duplicat și nu e', text: 'Verifică numărul documentului de marfă pe ambele rânduri. Dacă OCR-ul nu l-a citit pe unul, completează-l și eticheta dispare.' },
      { term: 'Numărul auto e un text fără sens', text: 'OCR-ul a prins altceva de pe pagină. Corectează-l în Editează; mașini noi se adaugă în Autoturisme numai pentru numere recunoscute ca numere de înmatriculare.' },
    ]),
  ],
};

const FULL_ONLY = [
  {
    id: 'module-tms',
    title: 'Restul platformei',
    lead: 'Module care există în Transitix complet, dincolo de fluxul de avize.',
    blocks: [
      terms([
        { term: 'Curse', text: 'Transporturile firmei, cu expeditor, destinatar, marfă, mașină și șofer.' },
        { term: 'Flotă și Șoferi', text: 'Datele mașinilor și ale echipei, cu avertizări la expirarea ITP, RCA și permis.' },
        { term: 'Dispecerat și Planificare', text: 'Alocarea zilnică a curselor.' },
        { term: 'Financiar', text: 'Facturi ca ciornă, cu numerotare ordonată. Trimiterea la ANAF nu e legată încă.' },
        { term: 'Verificări date', text: 'Lista problemelor de date pe care le vede programul, cu ce se strică dacă rămân.' },
        { term: 'Jurnal modificări', text: 'Cine ce a schimbat. Disponibil numai adminului.' },
      ]),
      note('Tracking GPS și Planning AI sunt demonstrative, cu date simulate. Sunt marcate ca atare în meniu.'),
    ],
  },
];

const COMPANION_ONLY = [
  {
    id: 'companion',
    title: 'Despre această aplicație',
    lead: 'Companionul RAI pentru documente, nu platforma completă.',
    blocks: [
      p('Are cinci ecrane, și atât: Avize / Rapoarte, Rapoarte, Harta zonelor, Autoturisme și Setări. Restul modulelor Transitix nu sunt aici, deliberat, ca fluxul de documente să nu fie îngropat sub ce nu folosești.'),
      p('Șoferii au aplicația lor pe telefon, cu un singur lucru de făcut: trimiterea documentelor de pe drum.'),
    ],
  },
];

export function officeGuide({ companion = false } = {}) {
  return {
    id: companion ? 'office-companion' : 'office-full',
    audience: 'Birou',
    title: 'Ghidul biroului',
    intro: companion
      ? 'Tot ce face aplicația, pe scurt și în ordinea în care ai nevoie. Caută mai jos dacă ai o întrebare anume.'
      : 'Referință pentru fluxul de documente și pentru restul platformei. Caută mai jos dacă ai o întrebare anume.',
    sections: [
      ...(companion ? COMPANION_ONLY : []),
      FLUX,
      INCARCARE,
      OCR,
      GREUTATE,
      EDITARE,
      TAXA_ZONA,
      AUTOTURISME,
      HARTA,
      TPO_CURSE,
      SABLOANE,
      AVERTISMENTE,
      UTILIZATORI,
      ...(companion ? [] : FULL_ONLY),
      PROBLEME,
    ],
  };
}
