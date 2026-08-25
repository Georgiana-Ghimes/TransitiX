# Sprint 2 — 25 august 2026

## CHANGELOG

P0/P1 (locații, rutare, board) au plecat ca **1.10.0**. De la ultima interogare (după acel release):

### Comenzi — ecran de creare

- **„Comandă nouă”** pe board-ul de dispecerat, plus **editare** și **ștergere** pe fiecare comandă neplanificată. Nu mai e nevoie de API-ul de entități ca să pui ceva pe board. Lista goală are un buton **Adaugă prima comandă**.
- Numărul comenzii se sugerează din dată (`CMD-20260827-01`) și **urmează câmpul de dată** — până când dispecerul scrie propriul număr, moment în care rămâne al lui. Ștergerea unei comenzi **nu** reia numărul (se scanează numerele existente, nu se numără rândurile).
- **Locația e obligatorie**, deși coloana e nullable: o comandă fără locație nu poate intra niciodată pe o rută. Locațiile fără coordonate se pot alege, dar sunt marcate ca atare; distanța de rută nu le include.
- Alegerea unui client restrânge locațiile la ale lui plus cele neatașate; dacă locația selectată nu mai e validă după schimbarea clientului, se golește singură.
- Tip: livrare / ridicare / schimb. Fereastră de livrare (sfârșit după început), timp de servire, cantități (numere pozitive), chip-uri de cerințe vehicul (ADR, frigo, lift-hidraulic, macara).
- Când nu există nicio locație, formularul explică de ce și trimite la Locații în loc să arate un select gol.

### Meniu birou

- **Dispecerat** apare imediat după Dashboard.
- **Locații** apare între Șoferi și Tracking GPS.

### P0 — Fundația geospațială

- **Tabela `locations`** — master data geocodată pentru orice punct pe care flota îl poate
  vizita: client, depozit, punct de lucru. Include coordonate cu sursă și scor de încredere,
  fereastră de livrare implicită, timp de servire implicit și restricții de acces
  (lungime/tonaj maxim vehicul). Entitate `Location` expusă prin API-ul de entități,
  acces doar pentru rolurile de birou.
- **Client OSRM** (`server/src/lib/geo/osrm.js`) — distanțe, durate, geometrie și matrice
  pe rețeaua rutieră reală. Fără stub: dacă `OSRM_URL` nu e setat, apelurile întorc 503 în
  loc să inventeze un kilometraj.
- **API `/api/geo`** — `GET /health` (stare OSRM + limite), `POST /route`, `POST /matrix`,
  `POST /nearest` (snap la drum, pentru validarea geocodărilor). Limitare la 120 cereri/minut
  per companie.
- **Sidecar OSRM** — `docker-compose.osrm.yml` + `npm run osrm:prepare`, care descarcă
  extractul Geofabrik și rulează `osrm-extract` / `osrm-partition` / `osrm-customize`.
  `--max-table-size 512`, ca matricele din P2 să încapă.
- **`/api/health`** raportează `capabilities.routing` (`"osrm"` sau `false`) și `capabilities.geocoding` (`"photon"` sau `false`).

**Validat:** București–Cluj = 440,1 km față de ~445 km în Google Maps (−1,1%, sub pragul de
±3% din criteriul de acceptare P0). Matrice 3×3 în 51 ms. Măsurat pe serverul public de
demo OSRM, cu coordonate de centru de oraș — graful local se ridică cu `npm run osrm:prepare`
imediat ce Docker e disponibil pe mașină.

- **Parser de adrese românești** (`server/src/lib/geo/address.js`) — adresele sunt un singur
  câmp text liber, fără coloane de oraș sau județ, așa că modulul sparge `"Cluj-Napoca,
  str. Fabricii 12"` în oraș / stradă / județ / cod poștal. Normalizează diacriticele (și
  varianta cu sedilă din datele vechi), canonizează abrevierile neambigue (`str.` → `strada`,
  `Șos.` → `soseaua`, `B-dul` → `bulevardul`) și deduce județul din oraș pentru ~90 de
  localități. Produce `address_key`, cheia de deduplicare și, ulterior, cheia de cache pentru
  geocodare.
- **Scor de geocodabilitate** — fiecare adresă primește un scor și un nivel: `good` (merge
  direct la geocoder), `review` (geocoder + confirmare pe hartă), `poor` (pin manual).
  Adresele fără număr sunt plafonate la 0,75 — un geocoder le poate duce cel mult la mijlocul
  străzii, ceea ce nu e punct de livrare. Cele rurale sunt plafonate la 0,6.
- **Backfill locații** — `npm run db:backfill:locations` citește adresele din `clients` și de
  pe ambele părți ale fiecărei `trips`, le deduplică, leagă partenerii de curse înapoi de
  clienți (după CUI, apoi după nume fără forma juridică) și raportează calitatea datelor.
  Rulează **dry-run implicit**; scrie doar cu `--apply`. Idempotent: la a doua rulare inserează 0.
- **Aplicat pe datele curente:** 4 adrese → 4 locații, toate cu județ rezolvat (B, BH, CJ, TM),
  2 legate automat de clientul corespunzător. Fără coordonate încă — geocodarea urmează.

- **Geocodare Photon** (`server/src/lib/geo/photon.js`) — adresă → coordonate, cu rezultate
  restrânse la bounding box-ul României. Photon nu întoarce un scor de încredere, așa că îl
  calculăm noi: precizia rezultatului dă plafonul (casă > stradă > localitate), iar potrivirea
  cu interogarea îl urcă sau coboară. Fiecare scor vine cu motivele lui (`oras_potrivit`,
  `strada_diferita`, `numar_negasit`), ca dispecerul să vadă *de ce* nu e sigur.
- **Praguri de decizie** (`server/src/lib/geo/geocode.js`) — ≥ 0,8 se salvează direct;
  0,45–0,8 se salvează dar rămâne nemarcat, pentru confirmare pe hartă; sub 0,45 nu se scrie
  nimic. **`geocode_verified` nu e setat niciodată automat** — doar de un om.
- **Tabela `geocode_cache`** — rezultatele se cachează pe același `address_key` ca `locations`,
  inclusiv ratările și erorile, ca o adresă proastă să nu fie retrimisă la provider la fiecare
  rulare. Company-scoped, nu global: lista de adrese căutate de un tenant *este* lista lui de
  clienți, iar un cache partajat ar scurge-o între tenanți pentru câteva apeluri HTTP economisite.
- **`npm run db:geocode:locations`** — geocodează locațiile fără coordonate. Dry-run implicit,
  `--apply` scrie, `--refresh` ignoră cache-ul, `--delay` respectă rate-limit-ul providerului.
- **API** — `POST /api/geo/geocode` (candidați ordonați, pentru ecranul de verificare),
  `POST /api/geo/locations/:id/geocode`. `GET /api/geo/health` raportează și starea Photon.
- **Aplicat pe datele curente:** 4 locații — 2 acceptate automat (1,00), 2 trimise la verificare
  (0,75 și 0,60).

- **Ecran `/locations`** — coada de verificare a geocodărilor. Se deschide pe cele mai proaste
  potriviri (fără pin → încredere mică → de verificat → încredere mare → confirmate), cu
  contoare pe fiecare nivel, filtre și căutare. Harta arată toate locațiile colorate după nivel;
  pinul selectat e **tras cu mouse-ul**, iar variantele găsite de geocoder se pot alege dintr-o
  listă cu scor și motive traduse („stradă diferită", „numărul nu a fost găsit").
- **Confirmarea e singurul lucru care setează `geocode_verified`.** Dacă pinul a fost mutat,
  sursa devine `manual` cu încredere 1 — un om care s-a uitat pe hartă e un semnal mai puternic
  decât orice scor de geocoder. Dacă nu a fost mutat, sursa rămâne cea a geocoderului.
- Ecranul funcționează și fără `PHOTON_URL`: butoanele de geocodare sunt dezactivate, cu un
  banner care explică de ce, dar pinul se poate pune manual.
- `src/lib/locationsUi.js` — praguri, sortare, filtrare și payload-ul de confirmare, separate
  de componentă și acoperite cu 32 de teste.

- **`trips.distance_km` automat** (`server/src/lib/geo/tripDistance.js`) — la salvarea unei
  curse, dacă ambele adrese se regăsesc în `locations` (sau în `geocode_cache`), distanța se
  calculează pe rețeaua rutieră prin OSRM și se rotunjește la kilometru.
- **`trips.distance_source`** — coloană nouă (`manual` / `osrm` / NULL) care spune cine deține
  valoarea. **O distanță scrisă de dispecer nu e suprascrisă niciodată.** Golirea câmpului o dă
  înapoi calculului automat; `POST /api/geo/trips/:id/distance` cu `{"force":true}` o forțează.
  Coloana e controlată de server și **nu** e în lista `writable` a lui Trip, ca un client să nu
  poată pretinde că o valoare e calculată automat. Distanțele existente au fost marcate `manual`
  la migrare — sunt anterioare acestui mecanism.
- **Salvarea unui CMR nu depinde de OSRM.** Coordonatele se citesc doar din tabele proprii
  (fără apel la geocoder pe calea de salvare), iar tot calculul e best-effort: cu OSRM căzut,
  cursa se salvează fără distanță. Verificat cu OSRM inaccesibil — cursă creată, zero erori.
- Hint în formularul de cursă care explică starea câmpului („calculată pe rețeaua rutieră" /
  „introdusă manual — golește câmpul ca să revină la calcul").

**Verificat pe date reale:** Timișoara → Oradea = 172 km, Cluj-Napoca → București = 450 km,
ambele din coordonatele confirmate în `locations`. Cele cinci tranziții de proprietate
(formularul retrimite valoarea noastră / dispecerul scrie altceva / resalvare / golire / câmp
fără legătură) se comportă corect end-to-end.

**P0 este încheiat.**

### P1 — Comenzi, rute, opriri (partea 1: model + mecanică)

- **Schema `orders` / `routes` / `route_stops`** — stratul de distribuție, strict aditiv.
  `trips` rămâne neschimbat (documentul CMR); s-a adăugat doar `trips.route_id`, opțional.
  O comandă e planificată **dacă și numai dacă** o oprire o referențiază — index unic parțial
  pe `route_stops(order_id)`, iar `orders` nu are pointer înapoi, ca cele două să nu poată
  ajunge în dezacord.
- `route_stops(route_id, seq)` e `UNIQUE ... DEFERRABLE INITIALLY DEFERRED`: reordonarea
  rescrie toate secvențele într-o singură tranzacție, altfel orice interschimbare ar da coliziune.
- **`server/src/lib/routing/routePlan.js`** — mecanica rutei, pură și testată (39 de teste):
  secvențiere (`moveStop`, `insertStop`, `applyOrder`, cu opririle de depozit ancorate prima și
  ultima), calculul segmentelor dintr-o matrice OSRM, programarea ETA-urilor cu timp de servire,
  verificarea ferestrelor de livrare, totaluri și verificarea capacității vehiculului.
- **API `/api/routes`** — `GET /:id/plan`, `POST /:id/stops`, `PUT /:id/sequence`,
  `DELETE /:id/stops/:stopId`, `POST /:id/recompute`. Fiecare modificare recalculează
  segmentele prin OSRM, reprogramează ETA-urile și scrie totalurile pe rută.
- Un ETA nu se inventează peste o gaură: dacă un segment nu are durată, ceasul se oprește și
  toate opririle următoare rămân fără ETA, în loc să afișeze ore false.
- O capacitate necunoscută pe vehicul e tratată ca necunoscută, nu ca zero — altfel dispecerul
  ar fi blocat de o limită inventată.

**Verificat end-to-end** pe 3 comenzi și o rută reală: Cluj → Oradea 155 km, Oradea → Timișoara
170 km (distanțe rutiere corecte, cu asimetria firească a sensurilor), ETA-uri în cascadă,
reordonare completă, refuz 409 la replanificarea unei comenzi deja pe rută, iar ștergerea unei
opriri readuce comanda în starea `nou`.

### P1 — partea 2: board-ul de dispecerat

- **Ecran `/dispatch`** — trei panouri: comenzi neplanificate, rutele zilei, hartă. Selector de
  dată, creare rută cu cod auto-incrementat (`R-01`, `R-02`), alocare vehicul/șofer/oră de start
  direct pe cardul rutei, recalcul manual și ștergere.
- **Fiecare acțiune are un buton.** Alocarea se face dintr-o listă („Planifică pe ruta…", care
  arată din start dacă adăugarea depășește capacitatea), reordonarea cu săgeți sus/jos,
  scoaterea de pe rută cu ×. **Drag-and-drop-ul e adăugat peste, doar pentru desktop** — HTML5
  DnD nu funcționează pe touch, iar `AGENTS.md` cere ca nimic critic să nu fie ascuns în spatele
  unui UI exclusiv desktop. Zero dependențe noi.
- Harta afișează opririle numerotate și colorate după starea lor (întârziere / prea devreme /
  fără ETA), plus traseul rutei selectate. Geometria reală se cere **o singură dată, pentru ruta
  selectată** — nu una pe rută.
- Când rutarea nu e configurată, board-ul spune explicit ce lipsește și de ce sunt goale
  distanțele, în loc să pară stricat. Nu se mai face niciun apel despre care se știe că va da 503.
- `src/lib/dispatchUi.js` — praguri, avertismente, formatări și validarea payload-ului de drag,
  separate de componentă și acoperite cu 34 de teste.

**Verificat în browser** pe date reale: 4 comenzi planificate pe o rută, reordonare (oprirea 3
mutată pe poziția 2, renumerotare corectă), scoatere de pe rută cu revenirea comenzii în lista
neplanificate, fără scroll orizontal la 360px și fără erori în consolă.

**Rămas din P1:** importul de comenzi din XLSX/CSV, generarea CMR-urilor dintr-o rută, foaia de
parcurs PDF și afișarea rutei ca listă de opriri în aplicația de șofer. Crearea din UI e gata.

## BUGFIX

- `serializeRow` întorcea `geocode_confidence`, `max_vehicle_length_m` și
  `max_vehicle_weight_t` ca șiruri, nu ca numere — coloanele `NUMERIC` noi nu se potriveau
  pe niciun tipar din lista de conversie.
- Parserul de adrese trata `"Cluj-Napoca"` și `"CLUJ NAPOCA"` ca localități diferite, ceea ce
  ar fi produs două locații pentru aceeași adresă. Cratima se normalizează acum la spațiu.
- O adresă fără virgulă între oraș și stradă (`"Timisoara Calea Aradului 50"`) își pierdea
  complet localitatea și județul, și pica de la scor 1,0 la 0,4. Ambele defecte au ieșit la
  iveală rulând pipeline-ul pe un eșantion de adrese murdare, nu pe datele de seed — care
  sunt prea curate ca să fie relevante.
- **Fals pozitiv grav la geocodare:** `"Calea Aradului 50, Timișoara"` era potrivită cu
  `"Calea Torontalului 50, Timișoara"` la încredere 1,00 și acceptată automat. Comparația de
  străzi se făcea pe textul întreg, iar cele două împart cuvântul „calea". Acum se compară
  doar numele străzii (`streetNameTokens`), iar o stradă diferită scade scorul cu 0,3 — destul
  cât să nu poată trece niciodată în accept automat. Rezultatul real a coborât la 0,60 → verificare.
- `lang=ro` era trimis către Photon la fiecare cerere, dar Photon acceptă doar
  `default/de/en/fr` — toate cele 4 geocodări întorceau 400. În plus, clientul raporta doar
  „Photon a răspuns 400" și ascundea cauza; acum extrage mesajul din corpul răspunsului.
- `de` era tratat ca tip de drum („drum european"), deși în adrese e prepoziție — rupea
  `„Fabricii de Zahăr"` în comparația de străzi.
- Un cod de județ singur (`„…, bucuresti, B"`, exact forma pe care o produce backfill-ul)
  ajungea lipit la stradă, iar `address_key` din `geocode_cache` ieșea `…|soseaua oltenitei 200 b`
  — diferit de cel din `locations`, deci cache-ul nu s-ar fi potrivit niciodată.
- În `locationsUi`, o locație fără coordonate sau fără scor trecea prin `Number(null)`, care e
  `0` și e finit — deci un pin lipsă s-ar fi afișat ca `0.000000` (un punct real în Golful
  Guineei), iar o încredere necunoscută ar fi apărut roșu, „încredere mică", în loc de
  „de verificat".
- În `routePlan`, `Number(null)` (care e `0` și finit) făcea ca un timp de servire nesetat să
  fie tratat ca zero în loc să cadă pe valoarea implicită — a treia oară când aceeași capcană
  apare în cod, acum izolată într-un helper `numOr`.
- `checkRequirements` deduplica după forma originală, deci `ADR` și `adr` apăreau amândouă ca
  cerințe lipsă.
- Un backtick într-un comentariu SQL din `migrate.js` termina template literal-ul JavaScript și
  fișierul nu se mai parsa deloc.
- În handler-ul PUT de entități, `distance_source` era adăugat în `data` **după** ce se citiseră
  cheile pentru clauza SET, deci lista de valori avea un element în plus față de
  placeholder-e: orice salvare de cursă cu distanță pica cu „bind message supplies 5 parameters,
  but prepared statement requires 4". Testele unitare nu puteau prinde asta — a ieșit la primul
  PUT real.

---

*Sprint 2 · deschis 25 august 2026*
