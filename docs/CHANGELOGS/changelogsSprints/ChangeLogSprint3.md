# Sprint 3 — 25 august 2026

## CHANGELOG

### Analiză TomTom — ce se poate și ce nu

- **Navigația offline nu se poate face în aplicația actuală de șofer.** Offline la TomTom
  înseamnă *Maps & Navigation SDK*, disponibil doar pentru **Android și iOS nativ**; nu există
  echivalent web. App-ul de șofer e o pagină React pură — fără Capacitor, Cordova sau React
  Native, și fără service worker. În plus, harta offline se livrează sub contract comercial
  (hartă + keystore + license token), iar pe iOS e „available upon request" prin Sales.
- Drum posibil, în trei trepte, dacă se dorește offline: **(1)** PWA cu service worker și
  ruta zilei cache-uită local — șoferul își vede opririle fără semnal, fără turn-by-turn;
  **(2)** shell Capacitor peste același cod React; **(3)** Navigation SDK în shell-ul nativ,
  cu plugin custom și contract. Treapta 1 acoperă cea mai mare parte a durerii reale.
- Ce **se poate** folosi acum, fără aplicație nativă: Search/Geocoding (implementat mai jos),
  Routing cu restricții de camion (greutate, greutate pe axă, dimensiuni, clasă ADR, cod de
  tunel ADR), Matrix Routing v2 și Traffic. Rutarea pentru camion acoperă rândul „Restricții
  camion" din matricea de decalaj, care era alocat lui Valhalla.

### Geocodare TomTom, ca escaladare

- **`server/src/lib/geo/tomtom.js`** — client pentru TomTom Search, cu aceeași formă ca
  `photon.js`: `tomtomConfigured()`, fetch injectabil, erori tipizate, `tomtomPing()`.
  Rezultatele se restrâng la România prin `countrySet`, atât din motive de calitate cât și de cost.
- **TomTom se apelează doar când Photon nu e sigur.** `escalatingSearch` rulează întâi
  furnizorul gratuit și escaladează la cel plătit numai sub pragul de acceptare automată (0,8).
  În practică asta înseamnă exact adresele rurale — cazul pe care Photon îl rezolvă cel mai
  prost și care e riscul #1 din planul inițial.
- **Un furnizor plătit indisponibil nu poate strica geocodarea.** Cheie greșită, cotă
  consumată sau rețea căzută: rezultatul gratuit rămâne în picioare, exact ca și cum TomTom
  n-ar fi fost configurat. Se aruncă doar dacă pică amândoi.
- Candidații de la ambii furnizori se păstrează și se ordonează împreună, ca ecranul de
  verificare să arate alternativele, nu doar câștigătorul.
- **Cache-ul e cheiat pe strategie, nu pe furnizor** (`photon` → `photon+tomtom`). Activarea
  TomTom retrage automat intrările vechi și retrimite prin furnizorul mai bun exact adresele
  slabe, fără să recalculeze nimic din ce Photon rezolvase deja bine.
- `GET /api/geo/health` și `/api/health` raportează starea TomTom separat; `capabilities.geocoding`
  devine `"photon+tomtom"` când amândoi sunt configurați.
- `TOMTOM_API_KEY` în `server/.env.example`. Lăsat gol, nimic nu se schimbă.

### Scor de potrivire partajat între furnizori

- **`server/src/lib/geo/matchScore.js`** — funcția de scor a fost scoasă din `photon.js` și
  făcută agnostică de furnizor. Motivul e important: întregul lanț — acceptare automată la 0,8,
  verificare la 0,45, culorile de pe `/locations` — compară scoruri fără să știe cine le-a
  produs. Doi furnizori cu fiecare propria noțiune de „încredere" ar fi rupt tăcut toate
  pragurile.
- Precizia rezultatului e acum o proprietate declarată (`address` / `street` / `locality` /
  `other`), nu dedusă din etichete OSM. TomTom o declară din tipul rezultatului; Photon o
  deduce ca înainte, deci comportamentul lui rămâne identic.
- **„Address Range" de la TomTom e tratat ca nivel de stradă, nu de adresă.** Are număr, dar e
  interpolat de-a lungul străzii — un ghici la nivel de stradă îmbrăcat în număr de casă, care
  n-are voie să câștige plafonul de încredere al unei adrese reale.
- Scorul propriu al TomTom (`score`) se păstrează pentru depanare, dar **nu** e folosit ca
  încredere: e pe altă scală și ar fi rupt pragurile.

### Neverificat încă

- Modulul TomTom **nu a fost rulat pe API-ul live** — nu a existat cheie. Parserul e scris
  defensiv, iar forma răspunsului e fixată prin fixture-uri în teste: dacă o cheie reală
  întoarce alte nume de câmpuri, se corectează întâi acolo și parserul urmează.
- Limitele exacte ale nivelului gratuit n-au putut fi confirmate — paginile de pricing de pe
  `developer.tomtom.com` redirecționează în buclă. Se știe doar că există free tier fără card,
  QPS între 5 și 50, și 429 la depășire.

### Ecran „Plan de încărcare" (`/loading`)

- **Ecran dedicat, cu căutare de vehicul după cod de model** — scrii „S-Way" sau „Actros" și
  primești vehiculul; caută și după număr, marcă sau șasiu. Alegi apoi una din rutele alocate
  vehiculului și vezi ce are de încărcat.
- **Profil de vehicul cu compartimente numerotate** (`001`…`006`), fiecare cu procentul lui de
  umplere, exact ca în FleetLoader — dar compartimentele sunt și butoane: click pe unul
  filtrează grilele la ce e încărcat acolo.
- **Compartimentele se calculează pe suprapunere, nu pe origine.** Un palet care stă călare pe
  două compartimente se împarte proporțional; altfel barele mint de fiecare dată când marfa nu
  e aliniată exact pe grilă.
- **Echilibru stânga/dreapta** — greutate pe partea șoferului vs pasagerului, cu diferența
  scoasă ca număr propriu. Paleții care traversează axul se împart proporțional. Peste ~20%
  dezechilibru apare avertisment: camionul trage vizibil și se vede la un control în trafic.
- Grilă de articole (oprire, articol, comandă, cantitate, greutate), panou pe opriri **în
  ordinea încărcării** (nu a livrării) și panou de colete nealocate — cele care nu au încăput.
- Avertismente pentru colete care nu încap, axă depășită, dezechilibru lateral și dimensiuni
  de cutie presupuse.
- `segmentFill` și `lateralBalance` în packer (server), `loadPlannerUi.js` și `TruckProfile.jsx`
  (client) — 30 de teste noi pe partea de prezentare, 12 pe packer.
- API nou: `GET /api/loading/vehicles?q=` (flotă căutabilă, cu cutia rezolvată pe fiecare
  vehicul) și `GET /api/loading/vehicles/:id/routes`. Numărul de compartimente e configurabil
  prin `segments` la `POST /loading/routes/:id/pack`.

**Verificat în browser** pe un Iveco S-Way cu cutie reală (13,6 × 2,45 × 2,7 m) și 36 de paleți
pe 4 opriri: 33 încărcați, 3 rămași, umplere 53%, echilibru lateral 2%. Fără scroll orizontal
la 360px, fără erori în consolă.

### Modul 2D Truck / Trailer Load Planning (`/load-planner`)

Motor de planificare a încărcării, reutilizabil, scris în **TypeScript strict** sub
`src/loadplanner/`. Domeniul e complet separat de UI: `domain/`, `planner/`, `validation/`,
`renderer/`, `components/`, `state/`, `data/`.

- **Vehicule parametrice, nu desene per model** — 15 template-uri (`Van L1/L2`, `Rigid
  7.5/12/18/26t`, `City rigid 10m`, `Curtainsider`, `Mega`, `Reefer`, `Box`, `Low-deck`,
  `Container 40ft`, `Swap body`, `Drawbar 2×7.45m`). SVG-ul e generat din geometrie: cabină,
  caroserie, podea, uși, axe, roți, compartimente. Un vehicul nou înseamnă un obiect nou de
  date, nu un desen nou.
- **Drawbar-ul are două compartimente separate** — marfa nu se poate așeza peste cuplaj, iar
  auto-load-ul le tratează ca zone distincte.
- **Toate dimensiunile interne sunt în mm și kg.** Conversia în pixeli există într-un singur
  loc, în renderer. Originea e colțul față-stânga al podelei: x pe lungime spre uși, y pe
  lățime dinspre șofer, z pe înălțime.
- **Drag & drop propriu, pe pointer events**, fără bibliotecă nouă. La drop, snapping pe
  pereți și pe fețele coletelor deja încărcate, așezare pe ce e dedesubt, iar dacă locul e
  ocupat se caută cel mai apropiat loc liber. Fiecare acțiune are și buton — drag-ul nu e
  niciodată singura cale.
- **Trei moduri de vizualizare** — sus, lateral, ambele. În modul dublu, selecția e comună.
- **Motor de validare separat** (`validatePlacement`, `validatePlan`): depășire lungime /
  lățime / înălțime, coliziuni, sarcină utilă, greutate pe axe, stivuire (`stackable`,
  `maxStackWeightKg`, sprijin sub 60% din bază) și ordinea de descărcare.
- **Ordinea de descărcare e avertisment, nu eroare** — un dispecer poate accepta conștient
  dubla manipulare.
- **Distribuție pe axe** ca model static de grindă: masa fiecărui colet acționează în centrul
  lui și se împarte între cele două axe vecine invers proporțional cu distanța. Nu e model de
  suspensie; e o bază corectă arhitectural, cu `axleContributors` care spune *care* colete
  încarcă axa depășită.
- **Auto load** — sortare după oprire (ultima intră prima, deci iese ultima), apoi greutate,
  apoi volum; rotații 0°/90°; verificare coliziuni și limite; umplere dinspre peretele din
  față spre uși. Raportează explicit ce n-a încăput și de ce.
- **Undo/redo** cu snapshot-uri (Ctrl+Z / Ctrl+Y), 50 de pași. Selecția nu intră în istoric.
  `R` rotește, `Delete` scoate.
- **Export/import JSON** versionat. Importul respinge un fișier care nu e plan sau are altă
  versiune, dar tolerează câmpuri lipsă și aruncă pozițiile orfane.
- **Capacitatea de paleți se derivă din geometrie**, niciodată hardcodată.

**Verificat în browser:** auto-load 40 de unități pe curtainsider — 45% volum, 73% greutate,
29,3/34 locuri de palet, toate axele în limite. Drag mutat un palet la x 8800 mm cu așezare
automată la z 1450. Rotația 90° schimbă amprenta 1200→800 mm, undo o readuce, redo o reaplică.
Export: 40 poziții, 5 unități, JSON valid. Schimbarea vehiculului golește pozițiile.
La 360px fără scroll orizontal, consolă curată.

**Performanță:** 500 de unități — auto-load 378 ms, validare + statistici 22 ms.

**Limitări asumate:** template-urile sunt aproximări de planificare, nu date de omologare;
modelul de axe e static, fără suspensie sau șa; stivuirea verifică sprijin și greutate, nu
rezistența ambalajului; auto-load-ul e first-fit, nu optimizator.

### Nucleul comercial: vehicul -> kilometri -> tarif -> taxe -> TPO (Faza 1 + 2)

Clientul a identificat corect problema centrala: nu camionul 2D, ci lantul
`document -> cursa -> vehicul -> kilometri -> tarif -> taxe -> TPO -> raport`. Fazele 1 si 2
din backlog sunt implementate.

**Date fundamentale (Faza 1)**

- **Clasa comerciala si MMA sunt doua coloane diferite** pe vehicul (`vehicle_class`, `mma_kg`).
  Un camion "10t" are in mod curent MMA 19t; tariful se negociaza pe clasa, taxele de zona se
  platesc pe MMA din talon. Confundarea lor ar fi facturat gresit fiecare cursa.
- **Garaj configurabil** — `companies.default_depot_location_id`, cu posibilitatea de a-l
  suprascrie pe cursa. Este o locatie normala, deci geocodata ca oricare alta.
- **Contracte si tarife contractuale cu istoric** — `contracts` + `contract_tariffs`. Randurile
  nu se editeaza niciodata: fiecare modificare adauga o perioada de valabilitate noua, iar
  fiecare cautare este *la o data*. Un raport pentru martie se recalculeaza cu tariful din
  martie chiar daca s-a renegociat de doua ori intre timp. Tarifele nu sunt luate de nicaieri
  automat — sunt contractuale.
- **Zone de taxare geografice** — `tax_zones` cu poligon GeoJSON *si* potrivire textuala
  (judet, oras, cod postal). Poligonul castiga cand punctul e geocodat; potrivirea textuala
  face motorul utilizabil din prima zi, inainte sa deseneze cineva vreun poligon.
- **Tarifele de zona depind de MMA**, in transe (`tax_zone_rates`). Fara MMA nu se ghiceste o
  transa — se raporteaza lipsa.
- **Taxe suplimentare** — `surcharge_types` + `surcharge_rates`, cu tarif per clasa de camion
  si un tarif atotcuprinzator ca rezerva. Taxa de macara (`DM`) e prima dintre ele.
- **Coduri de observatii** standardizate: tabelul existent a primit tip, stare activa si
  legatura catre taxa sau zona corespunzatoare.

**Cursa si TPO (Faza 2)**

- **Kilometrii includ drumul dus-intors la baza.** Nu `incarcare -> descarcare`, ci
  `garaj -> incarcare -> descarcare 1 -> descarcare 2 -> ... -> garaj`. Fiecare segment se
  pastreaza separat in `trip_legs`, ca totalul sa poata fi explicat rand cu rand.
- Un segment care nu poate fi masurat nu dispare in tacere: totalul e marcat incomplet si
  cursa primeste atentionare. A factura un total din care au disparut 40 km e mai rau decat a
  spune ca lipsesc.
- **TPO descompus, nu doar suma.** `trip_charges` tine cate un rand per componenta — tarif
  cursa, tarif kilometri, taxa zona, taxa macara, linii manuale. Suma e TPO-ul; randurile sunt
  ce se contesta pe factura.
- **Mai multe curse pe acelasi TPO.** `trips.tpo_number` nu e unic: marfa care nu incape
  intr-un camion se imparte pe doua curse sub acelasi TPO. Doua descarcari pe aceeasi cursa
  raman **o singura cursa**.
- **Greutate bruta** — `gross_weight_kg`, `net_weight_kg`, `pallet_weight_kg`, plus `quantity`
  si `quantity_unit` separat. Raportul are nevoie de greutatea de pe cantar (marfa + paleti),
  nu de "378 saci".
- **API** — `POST /api/tpo/trips/:id/calculate` (previzualizare sau salvare cu `persist`),
  `GET /api/tpo/:tpoNumber` (agregat pe TPO), `POST /api/tpo/:tpoNumber/recalculate`.
- Motorul de pret (`server/src/lib/pricing/`) nu citeste nimic din baza de date — totul intra
  ca parametru. Asa se poate recalcula orice luna trecuta cu tarifele de atunci, si asa e
  testabil fara server.

**Verificat end-to-end** pe exemplul clientului: camion B 123 ABC, clasa 10t, MMA 19t, doua
curse pe TPO-2026-0311.

```
Garaj -> incarcare       9,82 km
Incarcare -> descarcare 14,50 km
Descarcare -> garaj     22,94 km
                        47,26 km

Tarif cursa       500,00 lei
Tarif kilometri    85,07 lei   (47,26 km x 1,80)
Taxa zona ZB       75,00 lei   (MMA 19t, nu clasa 10t)
Taxa macara       120,00 lei
                  780,07 lei
```

Aceeasi cursa mutata pe 10 august foloseste automat tariful de la 1 iulie: 520 lei cursa,
1,95 lei/km, TPO 687,16 lei. Istoricul de tarife functioneaza.

**Ramas de facut:** Fazele 3-7 din backlog — upload multiplu si profile OCR pe tip de
document, motorul de sabloane de raport si exportul Baumit, aplicatia soferului cu formular
CMR digital, apoi automatizarile si zona avansata.

### Documente: profile OCR, incredere pe camp, corectie manuala (Faza 3)

- **Profile OCR pe tip de document, nu un parser unic.** `server/src/lib/ocr/profiles.js` tine
  cate un profil per *layout*: `aviz_baumit_psl`, `aviz_baumit_tro`, `aviz_generic`,
  `cmr_standard`. Fiecare declara cum se recunoaste si cum se citeste fiecare camp, deci un
  furnizor nou inseamna un obiect de date nou, nu o modificare in motor. Clientul a fost
  explicit: nu presupunem ca toate documentele au acelasi format.
- **Detectia e sugestie, nu verdict.** Profilele sunt punctate si returnate ordonat, iar
  operatorul poate forta altul cand scanarea e proasta.
- **Incredere pe fiecare camp, nu doar pe document.** Fiecare extractor intoarce
  `{ value, confidence, matched }`. Peste 0,8 campul e completat direct; intre 0,35 si 0,8 e
  completat dar marcat pentru verificare; sub 0,35 nu se pre-completeaza deloc. Ecranul de
  revizuire poate arata exact cele trei casute de verificat, nu tot documentul rosu.
- **Un camp etichetat valoreaza mai mult decat unul ghicit.** „Greutate bruta: 9.000 kg" trece
  la 0,95; „Greutate 9000 kg", fara eticheta, ramane la 0,55 — ar putea fi greutatea neta, si
  atunci decide un om.
- **Greutate bruta, separata de cantitate** — corectia ceruta de client. Raportul are nevoie de
  cifra de pe cantar (marfa + paleti), nu de „378 saci". Ambele se extrag, in coloane diferite:
  `gross_weight_kg`, `net_weight_kg`, `pallets`, `quantity`, `quantity_unit`.
- **Corectiile operatorului sunt sacre.** Campurile editate manual se retin in
  `corrected_fields` si sunt fixate la incredere 1. O re-extragere fortata reciteste tot ce n-a
  atins nimeni, dar **nu** suprascrie nimic corectat de om.
- **Upload multiplu** — pana la 40 de fisiere intr-o cerere, grupate intr-un lot
  (`document_batches`). Fluxul cerut e complet: incarci → OCR pe tot lotul → lista de
  rezultate → selectezi → confirmi.
- **Confirmarea refuza documentele necorectate** si spune care sunt; `force` trece peste, dar
  numai deliberat.
- **Istoric de document** (`document_events`): incarcat, extras, re-extras, corectat, confirmat,
  cu cine si cand. Un rezultat OCR corectat ulterior trebuie sa ramana explicabil peste luni.
- **Citirea textului** (`server/src/lib/ocr/readText.js`) incearca intai stratul de text al
  PDF-ului (gratuit si exact), apoi Google Vision pentru scanari. Sursa se raporteaza, fiindca
  schimba cat de mult se poate avea incredere: un strat de text e transcriere, un OCR e o
  presupunere. Vision indisponibil nu doboara upload-ul.
- **API** — `POST /api/documents/batches` (upload multiplu),
  `POST /api/documents/batches/:id/extract`, `GET /api/documents/batches/:id`,
  `PUT /api/documents/:id/corrections`, `GET /api/documents/:id/history`,
  `POST /api/documents/batches/:id/confirm`, `GET /api/documents/profiles`.

**Verificat end-to-end** pe trei avize de calitati diferite, incarcate impreuna:

```
aviz-psl-1.pdf    profil aviz_baumit_psl   incredere 0,89   campuri 11/11
aviz-tro-2.pdf    profil aviz_baumit_tro   incredere 0,86   campuri 10/11
aviz-vechi-3.pdf  profil aviz_generic      incredere 0,21   campuri  2/10
```

Confirmarea a fost refuzata cu 409 pana la corectie. Dupa corectia manuala pe documentul slab,
o re-extragere fortata a pastrat valorile puse de operator (`B 777 TRX`) si a recitit restul.
Istoricul arata `uploaded → extracted → corrected → re_extracted → confirmed`.

**Ramas de facut:** Faza 4 (motor de sabloane de raport, export Baumit, istoric exporturi),
apoi Faza 5 (aplicatia soferului) si urmatoarele.

### Rapoarte: selecție, previzualizare, export și istoric reproductibil (Faza 4)

- **Un vocabular de raportare, nu o listă de chei.** `server/src/lib/reporting/sources.js` ține
  fiecare câmp raportabil cu eticheta, tipul și formatul lui numeric. Un câmp nou înseamnă o
  intrare aici, nu modificări în trei fișiere, iar constructorul de șabloane are în sfârșit ce
  să-i arate operatorului.
- **Greutatea brută ajunge în raport** — corecția pe care clientul o cerea de la început.
  `gross_weight_kg`, `net_weight_kg`, `pallet_weight_kg`, `pallets` și `quantity_unit` sunt acum
  coloane exportabile, alături de cantitate, nu în locul ei.
- **Șabloane gata făcute** (`reporting/presets.js`): `Anexa Factura RAI` (14 coloane,
  contractuală), `Centralizator Baumit — greutăți` (livrări verificabile cu bonul de cântar) și
  `Centralizator km și tarife` (decontul lunar). Un preset se instanțiază ca șablon obișnuit,
  editabil.
- **Anexa RAI rămâne neatinsă.** Este o formă agreată cu clientul, deci nu i-am adăugat coloane.
  În schimb, când documentele au greutate iar șablonul ales n-o exportă, raportul spune asta
  explicit (`weight_not_exported`): foaia nu va putea fi confruntată cu cântarul.
- **Selecție după criterii, nu bifat rând cu rând.** Perioadă, număr auto, status, lot de
  documente, căutare liberă, „doar cele cântărite". Un raport fără niciun criteriu este refuzat —
  altfel ar cuprinde toată arhiva.
- **Previzualizare înainte de fișier.** `POST /api/reports/preview` întoarce rândurile,
  totalurile și avertismentele fără să scrie nimic. Operatorul vede foaia înainte s-o trimită.
- **O valoare lipsă rămâne goală.** O cântărire care nu s-a făcut nu se scrie `0` — pe foaia
  clientului un zero arată ca o mașină plecată goală și trage totalul în jos părând complet.
  Totalul spune câte rânduri n-a putut aduna.
- **Un tarif nu se adună niciodată.** Zece curse la 2,50 lei/km nu fac 25 lei/km. Coloanele care
  au voie să aibă total sunt declarate o singură dată, în `sources.js`.
- **Rând de total în Excel**, opțional — anexa RAI nu-l primește, fiindcă nu e forma agreată.
- **Istoricul păstrează conținutul, nu doar numele fișierului.** `aviz_export_log` reține acum
  rândurile randate, coloanele, totalurile, avertismentele și criteriile. O re-descărcare
  randează exact ce s-a trimis atunci — nu o recitire a documentelor, care între timp pot fi
  corectate.
- **Ecranul spune ce s-a schimbat de atunci.** Detaliile unui export arată câte documente au fost
  modificate sau șterse după generare. Un raport vechi nu devine greșit fiindcă datele s-au
  corectat — dar trebuie să se vadă că nu mai coincid.
- **API** — `GET /api/reports/sources`, `GET /api/reports/presets`,
  `POST /api/reports/templates/from-preset`, `POST /api/reports/preview`,
  `POST /api/reports/export`, `GET /api/reports/exports`, `GET /api/reports/exports/:id`,
  `GET /api/reports/exports/:id/file`.
- **Ecran nou** `/reports`, cu previzualizare live, avertismente explicate și istoricul
  exporturilor cu re-descărcare.

**Verificat end-to-end** pe un lot de trei avize (unul deliberat fără cântărire):

```
10.03.2026  B 123 ABC  PSL 4417/2026  brut=  9000  net=  8244  pal=18  cant=378 saci
11.03.2026  B 112 VFM  TRO 8053/2026  brut= 12400  net= 11560  pal=24  cant=768 galeti
12.03.2026  B 777 TRX  AVZ 91/2026    brut=     —  net=     —  pal= 4  cant= 96 saci

TOTAL: greutate brută 21.400 kg (1 rând fără valoare), paleți 46
Avertisment: „Fără greutate brută — 1 document"
Aceeași selecție pe Anexa RAI: „Greutatea nu ajunge în raport — 2 documente"
```

După ce un aviz a fost corectat (9.000 → 9.500 kg), istoricul a semnalat „1 document modificat
după export", re-descărcarea a produs tot 9.000 — fișierul trimis atunci — iar un raport nou pe
aceeași selecție a dat 21.900 kg.

**Rămas de făcut (închis pe Faza 5):** formularul CMR digital + poze pe loturi — livrat mai jos.
Coada Fazei 6 (validări / alerte) e deja livrată în mare parte; Faza 7 a fost depriorizată de client.

### CMR digital în aplicația șoferului + poze pe loturile din Documente

- **Formular CMR scris pe telefon**, nu doar poză. Pe detaliul cursei, șoferul vede câmpurile
  precompletate din cursă (expeditor, destinatar, transportator), completează ce a văzut la
  rampă (colete, greutate, natură, rezerve), semnează pe ecran la încărcare (expeditor +
  transportator) și din nou la livrare (destinatar). Ciorna se salvează; semnatul blochează
  etapa.
- Dacă pe cursă există deja un **CMR scanat**, formularul digital e dezactivat — nu apar două
  variante ale aceleiași note.
- **Pozele de pe drum (aviz, cântar, CMR hârtie, altele) nu mai stau doar pe cursă.** Intră în
  același lot `document_batches` ca upload-ul din birou (`created_from: driver`), cu OCR și
  coadă de revizuire. Dispecerul le vede împreună cu restul documentelor cursei.
- Upload-ul vechi „Încarcă CMR” pe `trip_documents` (cu OCR LLM pe loc) a fost înlocuit de cele
  două fluxuri de mai sus.
- **Același formular pe detaliul cursei din birou** — dispecerul poate completa / corecta /
  semna CMR-ul digital; scanul pe hârtie rămâne opțional și, odată încărcat, închide calea
  digitală pe cursă. Semnarea la livrare cere întâi etapa de încărcare.
- **După încărcarea semnată, greutatea / coletele / natura mărfii se scriu pe cursă** — aceeași
  cifră pe care o folosesc TPO-ul și rapoartele, nu o copie izolată în CMR.
- **Pozele din cabină pornesc OCR-ul singure** (în fundal), ca upload-ul din Documente. Pe
  `/avize` apar cu eticheta „De la șofer” și pot fi filtrate după proveniență.

### Verificări de date și alerte (coada Fazei 6)

Calculul automat era deja livrat prin motorul de tarife și taxe din Faza 2. Ce lipsea era stratul
care **spune când ceva e greșit** — înainte ca greșeala să ajungă pe o factură.

- **Șapte reguli, fiecare cu o consecință numită.** `server/src/lib/validation/rules.js` conține
  judecățile ca funcții pure; `checks.js` face interogările. O regulă intră în listă doar dacă i se
  poate spune concret ce strică. O alertă pe ceva doar neîngrijit învață oamenii să le ignore și pe
  cele care contează.
- **Cursă fără tarif valabil la data ei** — eroare. Este cea scumpă: TPO-ul se calculează oricum,
  arată tot ca un număr, și pur și simplu n-are linia de transport în el. Cursa pleacă subfacturată
  și nu se află până când cineva compară o factură cu contractul.
- **Total TPO diferit de suma liniilor** — eroare. Totalul este întotdeauna doar suma liniilor;
  dacă s-au despărțit, una dintre ele a fost editată singură.
- **TPO calculat fără kilometri**, **cursă modificată după calcul**, **aviz confirmat fără
  greutate brută**, **aviz confirmat nelegat de nicio cursă**, **același TPO pe mai multe
  documente** — avertismente.
- **Verificarea folosește exact aceeași căutare de tarif ca facturarea** (`findTariff`).
  Rescrierea ei aici ar fi permis alertei și facturii să nu fie de acord, ceea ce e mai rău decât
  să n-ai alertă.
- **Catalogul explică fiecare regulă** (`validation/catalog.js`): ce caută, ce strică dacă nu se
  rezolvă, și cum se rezolvă. Ecranul citește de acolo, deci regula și justificarea ei nu pot să se
  despartă.
- **Ecran nou `/checks`**, grupat pe reguli, cu erorile primele și deschise. Douăzeci de rânduri
  identice care spun „fără tarif" sunt un zid; un rând care o spune de douăzeci de ori e o sarcină.
- **Ascunderea unei constatări** folosește aceeași tabelă ca notificările, deci ce pui deoparte
  aici nu revine peste o oră prin clopoțel. Cheia conține faptul care se schimbă — o cursă
  modificată din nou reapare, chiar dacă a fost ascunsă înainte.
- **Doar erorile ajung în clopoțel.** Avertismentele stau pe `/checks`, unde e loc să fie
  explicate; toate în clopoțel ar îngropa alertele de cursă pentru care există.
- **CMR digital nesemnat la livrare** — o cursă livrată a cărei notă digitală a rămas deschisă.
  Fire doar pe notele care chiar au fost începute: o firmă care lucrează pe CMR-uri de hârtie
  n-are notă digitală deloc, iar o alertă pe fiecare cursă a lor ar face ecranul inutil.
- **API** — `GET /api/validation/rules`, `GET /api/validation/findings`,
  `POST /api/validation/findings/dismiss`.

**Verificat end-to-end** pe date construite anume: cinci curse (una perfect curată) și trei
documente confirmate.

```
[EROARE]  tpo_total_mismatch   TPO TEST-B   totalul 400,00 vs suma liniilor 350,00
[EROARE]  trip_no_tariff       TPO TEST-A   fara tarif „10t" valabil la data cursei
[atentie] document_duplicate_tpo            2 documente cu acelasi TPO
[atentie] document_no_weight                aviz confirmat fara cantarire
[atentie] document_unlinked     ×3          confirmate, dar fara cursa
[atentie] tpo_stale             TPO TEST-D  cursa modificata dupa calcul
[atentie] trip_no_distance      TPO TEST-C  TPO calculat fara kilometri

Cursa curata (TPO TEST-E): nicio constatare.
Clopotelul: exact 2 alerte, cele doua erori.
```

### O singură cale de export

Existau două. Cea veche, din ecranul `/avize`, scria în istoric doar numele fișierului și lista de
id-uri; cea nouă salva și conținutul. Practic, exact exporturile făcute pe drumul obișnuit erau
cele care nu se puteau re-descărca — și nu s-ar fi aflat până când un client ar fi cerut din nou
foaia de luna trecută.

- **Un singur înregistrator** (`reporting/exportLog.js`). Exportul XLSX, trimiterea pe email și
  arhiva ZIP din ecranul vechi trec toate prin el, deci istoricul e la fel de complet indiferent
  unde a fost apăsat butonul.
- **Anexa contractuală rămâne bit cu bit aceeași** pe calea veche: fără linie de total, aceleași
  coloane, aceeași ordine. S-a schimbat ce se reține despre ea, nu ce se trimite.
- `buildAnnexWorkbook` a fost eliminat — nu-l mai chema nimic în producție, iar testele lui îl
  țineau în viață. Testele exersează acum exact perechea de apeluri pe care o face ruta.

**Verificat:** un export făcut pe `/api/avize/export` apare în istoricul ecranului nou ca
reproductibil, cu 2 rânduri și un avertisment înregistrat („greutatea nu ajunge în raport" —
corect, anexa RAI n-are coloana), iar re-descărcarea lui produce un fișier identic cu originalul.
După o corecție ulterioară pe unul dintre avize, istoricul semnalează documentul modificat.

### Teste de rută pe Postgres real

Erau 1100 de teste, toate pe module pure, și **zero** pe handlerele HTTP. Fiecare defect serios al
proiectului a stat exact la cusătura pe care testele unitare n-o ating: un validator care accepta
doar șiruri când pg întorcea `Date`, o clauză SET desincronizată de lista ei de valori, un SELECT
care numea o coloană inexistentă. Niciunul nu e accesibil cu o bază de date simulată, și toate au
ajuns pe un server care rula.

- **`npm run test:api`** — aplicația Express montată cu supertest peste un Postgres adevărat.
  Separat de `npm test`, care rămâne rulabil pe un checkout curat, fără nimic pornit.
- **Baza de date se creează singură** și se migrează cu migrația de producție. O schemă construită
  altfel încetează să mai prindă erori de schemă.
- **Refuză orice bază care nu se termină în `_test`.** Suita șterge rânduri; nu există „înapoi”.
- **Fiecare fișier își seamănă propria firmă** și o șterge la final. `company_id` e izolarea.
- **75 de teste** pe rapoarte, CMR, documentele șoferului, verificări și — cel mai important —
  granița dintre firme: 14 verificări că o firmă nu poate citi, scrie sau șterge datele alteia, și
  că un `company_id` trimis în corpul cererii e ignorat.
- **CI rulează Postgres 16** ca serviciu și adaugă pașii de rute și de typecheck.
- `index.js` a fost împărțit: `app.js` construiește aplicația, `index.js` ține portul. O suită care
  ar fi trebuit să pornească un listener real ar fi ajuns să se bată pe porturi.

### CMR tipăribil

Aveam o scrisoare de transport pe care șoferul o semnează pe telefon și **nicio cale de a scoate
documentul**. Un CMR care trăiește doar în Postgres nu poate fi înmânat destinatarului, arătat la
un control, sau atașat la factură.

- **PDF A4 cu casetele numerotate** ale scrisorii de transport, generat din același model pe care
  îl vede formularul. Aceeași abordare ca la foaia de parcurs: pagina se construiește ca HTML și se
  rasterizează, fiindcă fonturile standard PDF nu pot scrie diacriticele românești — pe un document
  pe care un șofer îl arată unui inspector, un destinatar scris greșit nu e o problemă cosmetică.
- **O notă nesemnată se tipărește vizibil nesemnată.** „CIORNĂ — nesemnată” sau „semnat la
  încărcare · livrarea nesemnată”, cu bandă de avertizare. O pagină care arată ca un CMR complet
  când nimeni n-a semnat e mai rea decât nicio pagină.
- **Semnăturile se descarcă și se încorporează** înainte de randare — rasterizatorul clonează
  documentul și încarcă imaginile singur, fără șansa de a pune un header de autorizare. Dacă una nu
  se încarcă, ecranul o spune, fiindcă o casetă goală s-ar citi ca nesemnată.
- Scriitorul de PDF se încarcă la cerere: un șofer pe telefon nu plătește pentru jsPDF până când
  chiar are nevoie de o foaie.

### e-Transport: placeholderul devine imposibil de confundat

Un UIT se verifică în trafic. Codul de test genera `RO` + 16 caractere hex — adică ceva ce *arată*
exact ca un UIT valid, cu un mesaj alături pe care nimeni nu-l vede după ce codul e tipărit.

- **Codurile de test poartă prefixul `STUB-`, pe cod, nu lângă el.** Steagul de alături se pierde în
  momentul în care codul e tipărit, citit la telefon sau tastat în alt sistem. Șirul trebuie să ducă
  avertismentul cu el.
- **Ecranul nu mai afișează codul de test deloc** — arată „UIT DE TEST” pe fundal de avertizare.
- **`ETRANSPORT_MODE=anaf` fără credențiale eșuează zgomotos**, niciodată cu o retrogradare tăcută
  la stub. Un operator care a pus `anaf` crede că se emit coduri reale; un placeholder returnat
  acolo e exact drumul pe care un UIT fals ajunge la un control rutier.
- **Adaptorul ANAF există** — declarația e scrisă după contractul publicat, cu citirea răspunsului,
  tratarea refuzului și a indisponibilității. **Nu a fost rulat niciodată împotriva ANAF**, fiindcă
  nu există certificat. Testele acoperă construirea declarației și fiecare cale de eșec;
  transportul propriu-zis rămâne neverificat.
- `routes.uit_source` reține de unde a venit codul, iar `/api/health` raportează
  `anaf-unconfigured` distinct, ca nimeni să nu citească „pornit” drept „emite coduri reale”.

### Configurare comercială — ecranele care lipseau (`/commercial`)

Motoarele de tarifare, taxe de zonă și taxe suplimentare erau construite și testate din Fazele
1–2, dar nu exista **niciun ecran** pentru ele: se puteau edita doar prin API-ul generic de
entități. Practic, mașina de calcul n-avea volan. Baza de date o arăta — o singură zonă, un
singur tarif de zonă, un singur tip de taxă, toate semănate în timpul testelor.

- **Tarife contractuale**, grupate pe clasă de vehicul, cu istoricul complet al perioadelor și
  cea în vigoare azi marcată. Ecranul spune explicit că un tarif nu se editează în loc: se
  închide perioada veche și se adaugă alta de la data actului adițional, ca un raport din martie
  să rămână recalculabil cu tariful din martie.
- **Avertismentele vin din motorul de calcul**, nu din ecran: `findTariff` pentru „clasa asta
  n-are tarif valabil azi", `findOverlaps` pentru perioade suprapuse (aproape întotdeauna un
  „valabil până la" uitat). Un ecran care decide singur ce înseamnă „valabil" e exact felul în
  care un tarif arată activ pe ecran și e sărit la facturare.
- **Zone și taxe** — zone cu potrivire textuală sau poligon, și tranșe de taxă pe MMA. Ecranul
  repetă unde contează: taxa se calculează după MMA-ul din talon, nu după marfa încărcată.
- **Taxe suplimentare** — tipuri (cod, denumire, cum se aplică) și tarife pe clasă de vehicul.
- **Coduri de observații** cu import din `.xlsx` sau `.csv`, cu previzualizare înainte de
  scriere. Codurile sunt ale clientului; fiecare rând pe care importul nu-l poate folosi e numit
  și numărat, fiindcă un rând sărit în tăcere e felul în care dispare jumătate dintr-o listă.
- **Garaj** — se alege locația de bază, iar o locație fără coordonate e refuzată: fără ele
  drumul dus-întors nu se poate măsura, iar TPO-ul rămâne fără kilometri fără să spună nimeni.
- **20 de teste de rută** pe endpoint-urile noi, inclusiv izolarea între firme și importul.

### Clasa comercială și MMA pe vehicul

Prima cerință din brief — „tonajul trebuie asociat mașinii" — avea coloane în bază, era folosită
de motorul de tarifare, și **nu apărea deloc în formularul de vehicul**. Nu se putea seta.

Ambele câmpuri sunt acum pe formular, unul lângă altul, fiecare cu o notă care spune ce e
celălalt: clasa e banda pe care se negociază tariful, MMA e ce scrie în talon și după ea se
calculează taxele de zonă. Un camion de 10t are MMA ~19.000 kg.

### Bifa de descărcare cu macara

`crane_unload` exista pe cursă, iar calculul de TPO știa deja să caute taxa `DM` și s-o adauge.
Lipsea doar caseta de bifat. Acum e pe formularul de cursă, cu explicația că adaugă taxa în suma
configurată pentru clasa vehiculului.

### Dată facturare, separată de data cursei

Punctul 14 din cerințe cere „dată facturare" printre coloanele raportului. Aveam doar
`data_efectuare_cursa`, care e altceva.

- **Coloană nouă pe document** (`data_facturare`), disponibilă ca sursă în orice șablon și pusă
  pe „Centralizator km și tarife" — foaia de decont lunar, unde își are locul.
- **Se completează pentru toată selecția deodată.** O anexă se facturează la o singură dată; să
  ceri unui operator s-o scrie pe optzeci de documente e felul în care coloana rămâne pe jumătate
  goală. Câmpul e deasupra tabelului de previzualizare.
- **Nu atinge niciodată data cursei.** Tariful, taxa de zonă și taxele suplimentare se citesc
  toate *la data în care a rulat cursa*. Dacă am muta acea dată ca să se potrivească cu factura,
  am re-tarifa în tăcere fiecare linie și o schimbare de tarif la mijlocul lunii n-ar mai putea
  fi auditată.
- **Anexa RAI rămâne neatinsă** — e o formă agreată cu clientul. Coloana e disponibilă, dar
  adăugarea ei acolo e decizia clientului, nu a noastră.
- **Avertisment** când șablonul are coloana și documentele n-au data, cu trimitere la câmpul de
  completare în masă.

### Aplicația șoferului funcționează fără semnal

Șoferul e singurul utilizator care **garantat** pierde semnalul — în hale, la rampă, pe drumuri
de țară. Până acum, apăsarea pe „Semnează" într-o zonă fără acoperire arunca tot: ambele
semnături desenate cu degetul și rezervele scrise la rampă. Nu exista nici măcar o ciornă locală.

- **Ciorna se salvează la fiecare tastă**, nu la apăsarea butonului. Rampa e exact locul unde se
  închide aplicația, moare bateria sau se reîncarcă pagina.
- **Un outbox durabil** (`offlineQueue.js`) ține acțiunile netrimise. O salvare sau o semnare
  fără semnal intră în coadă și pleacă singură când revine acoperirea.
- **Semnăturile desenate merg în coadă cu tot cu cerneală** — sunt data-URL-uri de câțiva
  kilobytes, deci exact ce a desenat șoferul se păstrează.
- **Coada e FIFO și se oprește la prima cădere de rețea.** O semnătură depinde de ciorna pusă la
  coadă înaintea ei; dacă am sări peste, am semna o notă care încă n-a fost scrisă.
- **Ce a respins serverul nu se retrimite la nesfârșit.** Un 409 („semnat deja la livrare") sau un
  422 („lipsește greutatea") e răspunsul lui gândit, nu o problemă de transport: se parchează și i
  se arată șoferului, cu îndemnul să sune dispecerul.
- **Coada e pe utilizator.** Un telefon se dă din mână în mână; golirea semnăturilor netrimise ale
  cuiva sub sesiunea altcuiva le-ar lipi de cursa greșită.
- **IndexedDB, nu `localStorage`** — outbox-ul trebuie să poată ține și fotografii, iar
  `localStorage` se termină pe la 5 MB cu tot cu restul. Dacă stocarea nu e disponibilă (fereastră
  privată), aplicația funcționează normal, doar fără offline.
- **Golire și la deschidere, nu doar la revenirea semnalului.** Cazul cel mai frecvent n-are nicio
  tranziție: aplicația se închide în zona moartă și se redeschide în oraș.
- **Bandă vizibilă**: „Fără semnal", câte acțiuni așteaptă, buton de retrimitere manuală.
- **Recuperare de ciornă** la deschidere, dar numai dacă ciorna chiar diferă de ce are serverul —
  altfel prompt-ul apare de fiecare dată și șoferii învață să-l închidă fără să-l citească.
- **Pozele rămân online-only** și o spun explicit. Un fișier de 3 MB pus în coadă ar umple stocarea
  telefonului fără ca nimeni să știe.

**Verificat cu conexiunea tăiată în browser:** am scris o rezervare și am semnat ambele
casete fără rețea → două acțiuni în coadă, cu cerneala lor; am **reîncărcat pagina** → coada a
supraviețuit; am redeschis cursa cu semnal → s-a golit singură, iar rezerva și ambele semnături
au ajuns pe server.

### Delogarea chiar deloghează

`POST /auth/logout` returna `{ ok: true }` și nu făcea nimic. Clientul își ștergea tokenul din
`localStorage`, dar refresh-tokenul rămânea valabil șapte zile: un telefon pierdut sau un angajat
plecat păstrau accesul, iar butonul de delogare era decor.

- **Sesiuni urmărite** (`refresh_tokens`): fiecare refresh-token poartă un `jti` cu un rând în
  spate. Delogarea îl revocă, iar reîmprospătarea verifică rândul.
- **Rotație la fiecare refresh** — rândul vechi se revocă în clipa în care se emite cel nou, deci
  un refresh-token care scapă e folosibil cel mult o dată: următoarea reîmprospătare a clientului
  real îl invalidează.
- **„Închide toate"** în Setări, cu lista dispozitivelor autentificate acum. Delogarea încheie
  sesiunea de pe dispozitivul curent; asta e pentru celălalt caz — telefonul rămas în cabină.
- **Tokenurile emise înainte** de tabelă n-au `jti` și sunt acceptate o dată, apoi înlocuite cu
  unul urmărit. Altfel deploy-ul ar fi delogat pe toată lumea.
- **12 teste de rută** pe comportamentul de sesiune: delogarea oprește refresh-ul, alte sesiuni
  rămân valide, replay-ul unui token rotit eșuează, revocarea globală taie toate dispozitivele.

**Limita, spusă explicit:** tokenul de acces nu e verificat în bază la fiecare cerere — ar
însemna o citire înaintea fiecărui apel. Fereastra de expunere după o revocare e deci
`JWT_EXPIRES_IN`, acum **24h** în `.env`. Tabela de sesiuni nu o poate scurta; valoarea aia
trebuie coborâtă.

### Un ecran crăpat nu mai înnegrește aplicația

Nu exista niciun error boundary. O singură dereferențiere de null într-un `.map()` lăsa
utilizatorul în fața unei pagini albe — fără mesaj, fără drum înapoi. React însuși scria
„Consider adding an error boundary" în consola proiectului.

- **Boundary pe rută**, înăuntrul layout-ului: ecranul crăpat arată ce s-a întâmplat, iar **bara
  laterală rămâne funcțională**, deci se poate naviga în altă parte.
- **Boundary și în jurul întregii aplicații**, ca ultimă plasă pentru o cădere în router sau
  într-un provider.
- **Se resetează la schimbarea rutei** — altfel un boundary declanșat o dată ar rămâne blocat.
- Mesajul spune adevărul: „Restul aplicației funcționează. Nimic din ce ai salvat deja nu s-a
  pierdut."

**Verificat cu un ecran care crapă intenționat:** boundary-ul a prins eroarea, a afișat mesajul,
bara laterală a rămas pe loc, iar navigarea către alt ecran a revenit la normal.

### O singură cale pentru bani

Existau două. Motorul descompunea cursa în `trip_charges` — tarif cursă, kilometri, taxă zonă,
macara — și punea totalul pe cursă. Ciorna de factură ignora tot asta și aduna
`aviz_documents.valoare_tpo`, o coloană în care un operator scrie cu mâna și pe care OCR-ul o
poate completa. Cele două puteau să nu fie de acord, nimic nu le compara, deci o factură putea
pleca pe o cifră pe care nimic n-o recalculase.

- **Factura se construiește din liniile motorului.** Fiecare aviz → cursa lui → `trip_charges`.
  Atât.
- **Componentele ajung pe factură ca linii** (`invoice_lines`, oglindind `trip_charges`). Un
  client contestă „de ce 120 la macara", nu „de ce 975"; un subtotal singur nu-i dă la ce se uita.
- **O cursă fără TPO calculat e refuzată și numită**, niciodată înlocuită. O factură pe o cifră de
  origine necunoscută e mai rea decât una care refuză să se emită.
- **Când ciorna acoperă mai multe curse, antetul rămâne fără cursă.** Legarea ei de prima
  care s-a nimerit e felul în care un document ajunge arhivat la cursa greșită.
- **TVA-ul vine din regimul firmei**, nu dintr-un 19 fix — o firmă neplătitoare nu trebuie să
  aibă TVA adăugat.
- **Avertisment când totalul stocat nu se potrivește cu propriile linii.** Se facturează liniile,
  fiindcă ele sunt ce a calculat motorul, dar diferența se spune.
- **Ecran**: în Financiar, click pe numărul facturii deschide componentele. Selectorul „valoare
  TPO / km × tarif" a dispărut — nu mai e nimic de ales.
- **11 teste de rută**, inclusiv cazul în care avizul spune 1 și motorul spune 975: câștigă
  motorul.

### Retenție: tabelele care doar cresc

Nimic nu ștergea nimic. `telematics_positions` ia un rând la fiecare ping GPS — zece camioane
care raportează o dată pe minut înseamnă aproximativ cinci milioane de rânduri pe an — și nu
exista nicio politică, deci tabela creștea până observa cineva discul.

- **Șase politici**, fiecare cu tabelă, cheie și condiția „destul de vechi": poziții GPS (90 zile),
  `gps_logs` necurente (30), mesaje dispecer–șofer (365), alerte închise manual (180), sesiuni
  expirate (30), adrese geocodate (730 — ștergerea costă o interogare plătită ca să revină).
- **Listă protejată, explicită.** Un document despre ce am trimis unui client sau despre ce a
  făcut un om nu se șterge niciodată: `aviz_export_log`, `document_events`, `trip_charges`,
  `invoice_lines`, `delivery_proofs`, `trip_documents`. Un test verifică faptul că cele două
  liste nu se ating.
- **O singură condiție pentru numărare și pentru ștergere.** Previzualizarea nu poate descrie
  altceva decât ce ar șterge rularea.
- **Ștergere în loturi (5000) și sub advisory lock.** Un `DELETE` peste milioane de rânduri ține
  un lock lung și umflă tabela; două instanțe care șterg simultan se bat pe aceleași pagini.
  Când lotul se umple, răspunsul spune `more: true` — se mai rulează o dată, nu se mărește lotul.
- **Poziția curentă a unui camion rămâne.** `gps_logs` hrănește harta live; tăierea după vechime
  singură ar goli de pe hartă un vehicul care n-a mai mers de o lună.
- **Zero citit ca „mai vechi decât acum"**: orice `RETAIN_..._DAYS` care nu e număr pozitiv e
  ignorat, nu ascultat.
- **Ecran de control**: `GET /api/maintenance/retention` arată câte rânduri ar pleca și ce nu
  pleacă niciodată; `POST /api/maintenance/retention/run` rulează o trecere. Doar admin.
- **Programatorul pornește din `index.js`, nu din `app.js`** — altfel suita de rute ar porni un
  timer care șterge rânduri sub propriile teste.
- **13 teste unitare + 12 de rută**, printre care unul care rulează interogarea fiecărei politici
  pe schema reală.

### Cine ce a schimbat

`document_events` explica un aviz corectat. Nimic nu explica un tarif care s-a mutat, un garaj
schimbat — care schimbă tăcut toți kilometrii facturabili de după — sau o cursă editată după ce
fusese facturată. Astea sunt întrebările puse peste luni, de obicei de cineva care n-a fost în
cameră, iar răspunsul cinstit era „baza de date nu știe".

- **Tabelă nouă `audit_events`**, cu jurnal per firmă: acțiune, entitate, numele citibil al
  înregistrării, autorul, IP-ul și ce s-a schimbat.
- **Listă explicită, în ambele sensuri.** 19 entități se înregistrează (tarife, taxe de zonă,
  taxe suplimentare, curse, componente TPO, facturi, locații, vehicule, șoferi…), 11 nu — fiecare
  cu motivul scris. Un rând per ping GPS ar îngropa restul jurnalului și ar anula politicile de
  retenție; `AvizDocument` lipsește fiindcă `document_events` îl acoperă deja mai în detaliu.
- **Se salvează doar ce s-a schimbat efectiv.** Diferența se ia între rândurile din baza de date,
  nu față de ce a trimis clientul — așa apare și `distance_source`, pe care îl decide serverul.
  Salvarea unui formular neatins nu produce nicio înregistrare.
- **La ștergere se păstrează rândul întreg**, fiindcă nimic altceva nu-l mai are. Jurnalul
  supraviețuiește înregistrării pe care o descrie.
- **Valorile sensibile nu ajung niciodată acolo**, filtrate după tipar (`pass`, `token`, `hash`,
  `secret`, `api_key`…), nu după o listă de nume de coloane. Un câmp ascuns în plus e un mic
  inconvenient; un hash de parolă scăpat într-o tabelă făcută ca s-o citească oamenii, nu.
- **Scrierea e în aceeași tranzacție cu modificarea** — un jurnal cu goluri tăcute e mai rău decât
  lipsa lui, fiindcă un gol nu se distinge de „nu s-a întâmplat nimic". Dar nu strică niciodată
  cererea: modificarea a reușit deja când se scrie linia.
- **Numele autorului e denormalizat pe eveniment.** `user_id` e `ON DELETE SET NULL`, deci
  altfel ștergerea unui utilizator ar șterge exact faptul pe care rândul există să-l rețină.
- **Evenimente de securitate**: autentificare, autentificare eșuată pe un cont real, deconectare,
  încheierea tuturor sesiunilor. Un email inexistent nu produce nimic — nu aparține niciunei firme.
- **Mutarea garajului** se înregistrează cu numele locațiilor, nu cu id-uri.
- **Ecran nou „Jurnal modificări"** (doar admin), grupat pe zile, cu filtre pe tip, acțiune,
  utilizator, perioadă și căutare. Fiecare linie se deschide și arată câmpurile mutate,
  vechi → nou. Un panou spune ce **nu** se înregistrează și de ce, ca un gol să se citească drept
  decizie, nu drept defect. Istoricul unei singure înregistrări rămâne deschis întregului birou.
- **31 teste unitare pe server + 22 pe interfață + 23 de rută.**

### Administrarea utilizatorilor

Se făcea prin `INSERT`. Asta însemna trei lucruri deodată: doar cine avea acces la baza de date
putea adăuga un coleg, nimeni nu vedea cine ce rol are, iar parola trebuia să vină de undeva — deci
un admin ajungea să știe parola altcuiva.

- **Invitație, nu parolă.** Contul se creează cu un hash pornit din octeți aleatori și un link
  valabil 7 zile; persoana își alege singură parola, prin același flux de resetare care exista
  deja. Un admin care tastează parola unui coleg o știe pentru totdeauna, iar jurnalul nu-i mai
  poate deosebi pe cei doi.
- **Conturile se dezactivează, nu se șterg.** `users.id` apare în jurnal, în sesiuni și pe profilul
  de șofer; ștergerea rândului ar goli exact coloana care spune cine ce a făcut.
- **Ultimul administrator activ e protejat** — nu poate fi retrogradat sau dezactivat, și nimeni
  nu-și schimbă propriul rol sau nu se oprește singur. O firmă care face oricare din astea pierde
  dintr-o dată utilizatorii, tarifele și jurnalul, iar drumul înapoi e doar prin SQL.
- **Dezactivarea și schimbarea rolului încheie toate sesiunile.** Un token de acces deja emis
  rămâne valabil până expiră — răspunsul întoarce `JWT_EXPIRES_IN`, iar ecranul o spune, în loc să
  lase impresia că tăierea e instantanee.
- **Conturile de șofer se leagă de profilul de șofer.** Cursele se rezolvă prin `drivers.user_id`;
  fără legătură, contul se autentifică într-o aplicație goală. Dacă profilul are deja același
  email, se leagă singur la invitare; altfel lista o semnalează.
- **Fără provider de email, linkul se întoarce în interfață.** `sendEmail` reușește „în gol" când
  Resend nu e configurat; a raporta asta drept trimis ar lăsa un admin să aștepte un email care nu
  vine.
- **Nimic sensibil nu iese din API**: fără `password_hash`, `reset_token` sau secret 2FA, nici
  măcar către admin. Există test.
- **Toate acțiunile intră în jurnalul de modificări** — un ecran care poate da drepturi de
  administrator fără să lase urmă ar anula rostul jurnalului.
- **32 teste unitare pe server + 28 pe interfață + 31 de rută.**

## BUGFIX

- Două politici de retenție numeau coloane inexistente: `office_notification_dismissals.read_at`
  (tabela are doar `dismissed_at`) și `geocode_cache.address_key` drept cheie (cheia e `id`;
  `address_key` e unic doar împreună cu firma și furnizorul). Ar fi eșuat tăcut, noaptea, în
  programator. Prinse înainte de prima rulare.

- Ciorna de factură selecta `trips.client_id`, coloană care nu există — orice încercare răspundea
  cu 500. Prins de suita de rute la prima rulare, ca și `companies.city` înainte.

- **Coloana nouă de dată apărea cu o zi mai devreme.** `serializeRow` decide după numele coloanei
  dacă o valoare e zi calendaristică sau moment în timp, iar lista era ținută de mână
  (`_date`, `_expiry`, plus câteva excepții). `data_facturare` nu se potrivea niciuneia, deci
  trecea prin `toISOString()` — și cum pg întoarce `DATE` ca miezul nopții *local*, la est de
  Greenwich cădea în seara precedentă: pui 31 martie, în anexă apărea 30. Convenția românească
  `data_*` e recunoscută acum după tipar, nu memorată coloană cu coloană.
- **Formatarea datelor era legată de numele unei singure coloane.** `mapAnnexRows` verifica
  literal `col.source === 'data_efectuare_cursa'`, așa că în clipa în care a apărut a doua sursă
  de tip dată, aceasta a ajuns în ISO (`2026-03-31`) pe foaia clientului, lângă una scrisă
  românește. Formatarea se face acum după tipul declarat al sursei.

- **`CREATE EXTENSION pgcrypto` bloca migrația pe o bază nouă.** Extensia era trasă doar pentru
  `gen_random_uuid()`, funcție încorporată în PostgreSQL 13+ (compose fixează 16), iar pe o gazdă cu
  Application Control extensia nu se poate încărca deloc — pica toată migrația pentru o funcție pe
  care serverul o are deja.
- **Greutatea ajungea în CMR ca șir de caractere.** pg întoarce coloanele `NUMERIC` ca `string`,
  deci caseta 11 primea `"9000.00"` — afișat așa pe formularul șoferului și stocat așa în notă.
  Precompletarea trece acum prin aceeași conversie ca scrierea.
- **O extragere OCR în fundal putea anula o confirmare.** Încărcările din cabină pornesc OCR-ul
  asincron; dacă biroul confirma lotul cât timp ultima pagină încă se citea, extragerea scria
  `extracted` peste `confirmed` la final. Un lot merge acum doar înainte.
- **Testele de rută semănau fișiere în `server/uploads/`.** `UPLOAD_DIR` era în `.env.example` dar
  nu era citit niciodată — importurile ES se evaluează înainte de `dotenv.config()` din entrypoint.

- **CMR-ul purta data de ieri.** pg întoarce o coloană `DATE` ca miezul nopții *local*, iar
  `toISOString()` pe ea cade în seara precedentă oriunde la est de Greenwich — caseta 4 („locul
  și data încărcării") și caseta 21 arătau 25 august pentru o cursă încărcată pe 26. Aceeași
  capcană ca la tarife; acum se folosește data calendaristică locală.
- `loadCompany` din ruta de CMR selecta o coloană `city` care nu există pe `companies`, deci
  orice deschidere a formularului răspundea cu 500. Locul întocmirii vine acum din locația de
  garaj implicită, iar fără garaj setat caseta rămâne goală — un oraș ghicit pe o scrisoare de
  transport e mai rău decât o casetă necompletată.

- **Antetul ecranului de verificări se contrazicea cu lista lui.** Rezumatul se calcula înainte de
  a scoate constatările ascunse, deci scria „2 probleme care afectează facturarea" deasupra unei
  liste cu una singură — iar operatorul n-avea cum să știe care jumătate are dreptate. Acum se
  numără rândurile de pe ecran, atât pe server cât și după o ascundere în interfață.
- Un document era identificat în constatări după numărul de TPO. Exact în cazul pe care regula de
  duplicate există ca să-l prindă, două rânduri purtau aceeași etichetă și nu se putea spune care
  document trebuie deschis. Acum eticheta este numele fișierului.

- **Numărul de TPO se pierdea pe jumătate.** `normalizeTpo` prindea doar primul șir de cifre
  după „TPO", așa că `TPO 2026-0311` devenea `TPO-2026`: toate cursele unui an ajungeau pe
  același număr în anexă — coloană cheie a formei contractuale — iar o selecție perfect curată
  era raportată ca având TPO-uri duplicate. Acum identificatorul se păstrează întreg, cu
  separatorii normalizați.
- **Un document putea rămâne blocat în verificare pentru totdeauna.** Extractorul numește câmpul
  `quantity`, dar ecranul de revizuire arată coloană `cantitate_marfa`. Corecția operatorului
  ateriza pe un câmp pe care extractorul nu-l cunoștea, `quantity` rămânea `missing`, iar avizul
  nu mai putea fi confirmat niciodată. Cele două nume sunt acum legate explicit.

- `applyToLocation` scria mereu `geocode_source = 'photon'`, indiferent de cine produsese
  pinul. Cu escaladarea activă, orice pin venit de la TomTom ar fi fost etichetat greșit că
  Photon — adică exact urma de care ai avea nevoie ca să înțelegi de ce o adresă a costat bani.
  Acum se scrie furnizorul candidatului câștigător.
- Constrângerea `CHECK` de pe `locations.geocode_source` nu accepta `'tomtom'`, deci prima
  salvare a unui pin TomTom ar fi picat cu eroare de constrângere. Lista a fost lărgită, cu
  `ALTER` separat pentru bazele create înainte.
- Candidații Photon nu declarau câmpul `provider`, așa că după unirea listelor de la cei doi
  furnizori nu se mai putea spune care rezultat de la cine venea.
- **Extractorul de cantitate înghițea greutatea.** Pe un aviz care scrie doar „Greutate
  4200 kg", fără linie de cantitate, tiparul liber pentru cantitate prindea „4200 kg" și
  raporta 4200 ca fiind cantitatea de marfă — exact confuzia dintre cantitate și greutate pe
  care clientul ne-a cerut s-o eliminăm. Acum unitățile de greutate nu mai sunt acceptate că
  unități de cantitate decât după o etichetă explicită „Cantitate".
- Numărul de paleți se citea doar în forma „18 paleti", nu și „Paleti: 18" — jumătate din
  layout-uri pierdeau câmpul.
- Numărul de CMR prindea primul cuvânt după „CMR", deci „CMR SCRISOARE DE TRANSPORT" dădea
  numărul de document „SCRISOARE". Acum valoarea trebuie să conțină o cifră.
- `quantity_unit` era singurul câmp fără `status`, deci scăpa din verificarea de completitudine.
- **Tarifele contractuale nu se potriveau niciodată când datele veneau direct din baza de
  date.** pg întoarce coloanele `DATE` ca obiecte `Date`, iar `toDate` accepta doar șiruri
  ISO — deci `valid_from` pica silențios validarea și fiecare cursă ieșea cu TPO 0 și
  „fără tarif". A ieșit la iveală abia la primul calcul pe date reale; testele unitare
  foloseau șiruri. Acum acceptă ambele forme, cu dată calendaristică locală ca o dată la
  miezul nopții să nu alunece cu o zi înapoi.
- Auto load-ul din plannerul 2D plasa doar o parte din marfă fără să spună de ce — restul
  dispărea tăcut. Acum lista celor neîncăpute apare pe ecran, cu motivul („mai înalt decât
  cutia" / „nu mai este loc"). Un planner care ascunde marfă e mai rău decât unul care refuză.
- Cele două strategii de încărcare („Ordine șofer" / „Ordine depozit") păreau identice pe
  comenzi fără SKU: strategia de depozit sortează după zonă de picking și apoi SKU, iar fără
  niciuna cade pe același criteriu ca LIFO. Comportamentul era corect, dar arăta ca un buton
  stricat — acum ecranul spune explicit de ce nu se schimbă nimic.
- **Ghidul de onboarding bloca meniul lateral.** Cât timp era deschis, orice click pe un alt
  ecran te arunca înapoi pe pasul curent al turului — părea că mai multe meniuri „crapă” sau
  nu răspund. Navigarea forțată se face acum doar când schimbi pasul din ghid, nu la fiecare
  schimbare de rută.

---

*Sprint 3 · deschis 25 august 2026 · actualizat 26 august 2026*

### Branding Transitix (logo + favicon)

- Favicon din `512x512-FAVICON-TRANSITIX.png` (tab browser).
- Login: logo-ul color (`Asset 5`) în locul iconiței cu săgeată.
- Meniu stânga sus: același logo color + „TMS Platform”; pe dark mode (`html.dark`) trece pe
  varianta albă (`Asset 10`). La meniul restrâns rămâne doar marca pătrată.

### Versiune 1.12.0

Bump minor față de 1.11.x: livrările Sprint 3 vizibile utilizatorului (geocodare TomTom,
OCR/loturi documente, rapoarte cu istoric, verificări date, CMR digital + loturi din App
Șofer, branding logo/favicon, Plan 2D / încărcare în ghiduri). Versiunea e aliniată în
`package.json` (UI + server).

### Ghiduri utilizator (`docs/guides/`)

- Suită de documentație pe sarcini, în română: introducere, quickstart, ghiduri pe rol
  (dispecer, șofer, client, admin), ghiduri pe funcționalitate (curse/CMR, flotă/tarife,
  rapoarte/avize, setări), depanare și glosar.
- Ghidul dispecerului detaliază și **Încărcare** + **Plan 2D** (vedere camion, drag-and-drop
  și butonul „Plasează 1”), pe limba utilizatorilor mai puțin tehnici.
- Termenii urmează UI-ul Transitix; stub-urile (UIT, UBL/SPV, chat simulat) sunt marcate
  explicit. Fișierele stau sub `docs/` (locale, necomis).
