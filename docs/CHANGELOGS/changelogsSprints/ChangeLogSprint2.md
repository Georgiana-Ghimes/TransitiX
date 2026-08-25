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

### P1 — partea 3: import, CMR-uri, foaie de parcurs, ruta la șofer

**Import comenzi din XLSX / CSV**

- Buton **Import** pe board-ul de dispecerat. Se acceptă `.xlsx` și `.csv`, iar capul de tabel
  e recunoscut după denumirile uzuale — „Număr comandă", „Locație", „Data", „Greutate",
  „Paleți" — cu sau fără diacritice. Coloanele pe care nu le recunoaștem sunt **raportate**,
  nu ignorate în tăcere: un cap de tabel scris greșit e cel mai frecvent motiv pentru care un
  import „pierde" date.
- Fișierul se **previzualizează întâi**, linie cu linie: ce se importă, ce nu și de ce.
  Serverul rulează exact același plan la previzualizare și la import, deci ce aprobă
  dispecerul e exact ce se scrie. Scrierea se face într-o singură tranzacție — un fișier pe
  jumătate stricat nu lasă niciodată un import pe jumătate făcut.
- Cifrele românești sunt citite corect: `1.234,56`, `1234,56` și `1234.56` dau toate același
  număr, iar `1.500` e o mie cinci sute, nu unu virgulă cinci. Datele sunt zi-întâi
  (`03.04.2026` = 3 aprilie), se acceptă și celulele de tip dată din Excel.
- **Locația trebuie să existe deja** — se potrivește după nume sau după aceeași cheie de
  adresă folosită de restul aplicației, deci o adresă scrisă puțin altfel ajunge tot pe pinul
  corect. O linie fără locație nu se importă: o comandă fără locație n-ar putea intra
  niciodată pe o rută. Un nume purtat de două locații e refuzat explicit, nu ghicit.
- Numerele duplicate sunt prinse și față de baza de date, și **în interiorul fișierului**.
  Există un șablon descărcabil, ca dispecerul să nu ghicească formatul.

**CMR-uri dintr-o rută**

- Buton pe cardul rutei care emite **câte un CMR pentru fiecare oprire cu comandă**.
  Sensul documentului urmează tipul opririi: la livrare firma e expeditor și locația e
  destinatar, la ridicare invers. Numerotare secvențială pe zi (`CMR-2026-0827-01`).
- **Se poate apăsa de câte ori e nevoie.** Opririle care au deja document sunt sărite, deci o
  rută care primește o oprire nouă produce doar CMR-ul care lipsea, nu încă un set complet
  peste cele deja tipărite și date șoferului.
- Adresa de pe document se recompune din stradă + localitate + județ. Locațiile țin orașul
  într-o coloană separată, iar un CMR cu stradă și fără oraș nu e o adresă de livrare.
- Cursele preiau șoferul, vehiculul, ora estimată de sosire, marfa și cantitățile din plan.
  O rută fără șofer produce curse `planificată`; cu șofer, `alocată`.

**Foaie de parcurs (PDF)**

- Buton pe cardul rutei care descarcă foaia de parcurs în format A4 landscape: antetul
  firmei, ruta, șoferul, vehiculul, ora de plecare, distanța și durata, apoi tabelul
  opririlor cu oră estimată, client, adresă, comandă, cantități și interval.
- Fiecare oprire are **două căsuțe goale** — ora reală și semnătura — pentru că e un document
  de lucru, completat pe teren. La final, câmpuri pentru km la plecare/sosire, alimentare și
  semnăturile dispecerului și șoferului.
- Avertismentele rutei (întârzieri, depășire de capacitate, estimări incomplete) se
  **tipăresc**, ca șoferul să plece știind de ele.
- Se paginează la 12 opriri pe pagină, cu antet pe fiecare pagină și semnături doar pe
  ultima. O oprire nu e niciodată tăiată între două pagini — o oprire tăiată în două e o
  oprire pe care n-o semnează nimeni.
- Unde nu apare o oră estimată, căsuța rămâne **goală**, nu cu linie: o estimare inventată pe
  un document semnat e mai rea decât nicio estimare.

**Ruta ca listă de opriri în aplicația de șofer**

- Tab nou **Rută** în aplicația de șofer, cu navigare pe zile (ieri / azi / mâine).
  Fiecare oprire e un card: numărul de ordine, client, adresă completă, ora estimată,
  intervalul de livrare, cantitatea și notele de acces.
- **Un singur buton principal pe oprire:** „Am ajuns", apoi „Gata" sau „Nu s-a putut".
  Pe o oprire închisă nu mai apare nimic — anularea e treaba dispeceratului, nu ceva peste
  care șoferul dă din greșeală în timp ce parchează. Toate butoanele au minim 44px.
- Ora de sosire e pusă **de server**, nu trimisă de telefon: un ceas dat cu o oră greșit ar
  ajunge altfel în dovada de livrare.
- Bifarea unei opriri mută și comanda (`pe rută` → `livrat` / `eșuat`) și starea rutei
  (`în execuție` → `finalizată`), fără ca cineva să trebuiască să-și amintească.
- Navigare către adresă și apel direct către persoana de contact a locației, cu revenire la
  telefonul clientului dacă locația nu are unul.

**Verificat pe date reale:** import CSV cu punct-și-virgulă și import XLSX cu celule de dată
reale (2 linii bune, 1 locație inexistentă, 1 număr duplicat — exact ce a raportat
previzualizarea); două CMR-uri emise dintr-o rută, a doua apăsare n-a mai creat nimic;
șoferul a văzut ruta zilei, a bifat o oprire, iar comanda și ruta și-au schimbat starea
singure.

**P1 este încheiat.**

### Distanțele măsurate o dată rămân măsurate

Aplicația își amintește distanțele rutiere pe care le-a calculat deja. Până acum, fiecare
recalcul de rută întreba din nou motorul de rutare aceleași lucruri: distanța dintre depozit
și fiecare client se măsura de la zero în fiecare dimineață, deși drumurile nu se schimbaseră
peste noapte.

- Un plan care conține doar opriri deja cunoscute nu mai are nevoie deloc de motorul de
  rutare — răspunde instant, din ce s-a măsurat înainte.
- Când apare o comandă la o adresă nouă, se măsoară doar drumurile către și dinspre ea, nu
  întreaga rețea. La un plan de 200 de opriri cu 5 adrese noi, asta înseamnă sub 5% din
  munca de dinainte.
- Un client re-geocodificat, al cărui pin s-a mutat cu câțiva metri pe aceeași stradă, își
  păstrează distanțele. Ele sunt reținute pe punctul de pe drum, nu pe coordonata exactă.
- Valorile expiră după 30 de zile (configurabil), ca o rută ocolită de un drum nou să nu
  rămână greșită la nesfârșit.
- Dacă memoria asta nu poate fi citită sau scrisă dintr-un motiv oarecare, planificarea merge
  mai departe și măsoară normal. Nu se poate transforma într-o pană.

Nu e o funcție vizibilă în interfață — e pregătirea pentru optimizatorul din faza următoare,
care cere aceeași matrice de distanțe la fiecare rulare.

### Început de P2: temelia optimizatorului

Prima bucată din faza de optimizare. Încă nu există un buton „optimizează" — se pun la loc
datele fără de care optimizatorul n-ar avea ce compara.

**Pe fișa vehiculului** apar câmpuri noi, pe care le poate completa oricine cu acces la flotă:

- Capacitate în **paleți**, alături de kg și mc. E a treia dimensiune pe care se planifică
  efectiv, și nu se poate deduce din celelalte două.
- **Dotări** (ADR, frigo, lift hidraulic, …) — perechea cerințelor pe care le poartă deja
  comanda. O comandă ajunge doar la un vehicul care are tot ce cere ea.
- **Depozitul de bază**, de unde pleacă și unde se întoarce vehiculul dacă planul nu spune
  altceva.
- **Cost pe km și pe oră**, opționale. Dacă nu le completează nimeni, optimizatorul lucrează
  pe timp și nu raportează niciun cost — nu inventează un preț ca să pară că a socotit.

**Pe fișa șoferului** se pot seta ora de început și ora de sfârșit ale turei. Ruta lui nu va
depăși intervalul, indiferent de ce vehicul conduce.

O capacitate necompletată nu blochează nimic: se citește ca „nu s-a notat", nu ca „zero", deci
vehiculul rămâne folosibil.

### Optimizatorul poate rula o zi și propune un plan

Dispecerul poate cere optimizarea comenzilor deschise ale unei zile. Rezultatul se salvează
ca **scenariu** — o propunere, nu o decizie. Se pot rula mai multe scenarii pe aceeași dată
(de exemplu cu flote diferite) și se compară pe km, ore, cost și comenzi rămase nealocate.

- Un scenariu se **promovează** în planul zilei: înlocuiește doar rutele încă în draft /
  planificate. Dacă există deja o rută lansată sau în execuție, promovarea e refuzată — 
  optimizatorul nu scoate un camion de pe drum.
- Comenzile din rutele înlocuite revin la „nou", apoi cele din noul plan trec la „planificat".
- Șoferii preferați (deja pe rutele zilei) rămân pe aceleași vehicule; restul se împerechează
  în ordinea din listă.
- Dacă motorul de rutare sau optimizatorul nu sunt porniți, cererea e refuzată clar (nu se
  inventează un plan).

Interfața dedicată (înlocuirea stub-ului Planning AI) urmează; API-ul e gata.

### Reg. 561/2006 în plan, nu doar în raport

După ce optimizatorul propune rutele, sistemul le trece prin regulile de timp de
conducere: pauză de 45 de minute după 4 ore și 30 de minute de condus, și repaus
zilnic de 11 ore după 9 ore de condus. Pauzele și repausurile apar ca opriri reale
în rută (nu ca avertismente la final), iar un drum mai lung decât limita e împărțit —
șoferul oprește, apoi continuă.

Dacă o pauză împinge o livrare în afara ferestrei clientului, încălcarea e raportată
în scenariu, ca dispecerul să vadă costul respectării legii.

### Planning AI e optimizatorul real

Pagina Planning AI nu mai e un stub cu sugestii inventate. Pe dată, poți:

- vedea dacă rutarea și optimizatorul sunt disponibile;
- rula un scenariu pe comenzile deschise ale zilei;
- compara scenariile pe km, ore, cost, comenzi nealocate și pauze 561/2006;
- promova un scenariu în planul de dispecerat sau șterge unul nepromovat.

Fișele de vehicul și șofer au câmpurile de care optimizatorul are nevoie: paleți,
dotări, cost pe km/oră, tură.

### Telematică reală (început P3)

Pozițiile vehiculelor nu mai trăiesc doar din butonul „Simulează".

- App-ul de șofer trimite GPS-ul telefonului cât timp are o rută alocată (cu acordul
  sistemului de locație al telefonului).
- Furnizorii externi (Webfleet, Frotcom, Teltonika sau orice webhook) pot posta pe
  `/api/telematics/ingest` cu o cheie pe firmă — administratorul o generează din pagina GPS.
- Harta Tracking GPS se reîmprospătează la 30 de secunde, arată sursa fiecărei poziții și
  păstrează simularea doar ca demo.
- Istoricul e păstrat separat; pe hartă rămâne „ultima poziție cunoscută", ca înainte.

### Excepții live pe rută

Când o poziție GPS ajunge pe o rută lansată azi, sistemul verifică planul și poate
deschide o excepție: întârziere, sosire prea devreme, abatere de traseu, staționare
sau viteză. Excepțiile apar pe Dispecerat și pe Tracking GPS; dispecerul le poate
confirma sau închide. Clopoțelul biroului anunță fiecare excepție nouă.

La o întârziere nouă, ETA-urile opririlor rămase pe rută se mută înainte cu același
decalaj, iar clienții cu email pe acele opriri primesc un mesaj de actualizare
(dacă email-ul e configurat pe server).

### Board live (SSE)

Dispeceratul și Tracking GPS primesc actualizări pe flux (poziții, excepții, ePOD)
fără să aștepte poll-ul. Când fluxul e activ, pe hartă marker-ele se colorează după
severitatea excepției, iar pe fiecare rută din board apare o bară plan vs. realizat.
Dacă conexiunea pică, rămâne reîmprospătarea periodică.

### ePOD în app-ul de șofer

La **Gata** sau **Nu s-a putut** pe o oprire de livrare/ridicare, șoferul completează
dovada: nume destinatar + semnătură pe ecran (sau motiv de refuz), opțional o poză.
Oprirea se închide odată cu salvarea; biroul e anunțat la clopoțel.

### Reluare istorică pe hartă

Pe Tracking GPS, **Reluare** lasă dispecerul să aleagă o zi și o rută: traseul planificat
(pe rețeaua rutieră) apare albastru, iar firul GPS realizat apare portocaliu punctat.
Sub hartă vezi kilometrii planificați vs. realizați, diferența și câte opriri s-au închis.
Fără date GPS în ziua respectivă, rămâne doar planul (dacă rutarea e disponibilă).

### Plan de încărcare (început P4)

Pe Dispecerat, fiecare rută cu vehicul are un buton de **plan de încărcare**: sistemul așază
paleții în remorcă (LIFO — ultima livrare aproape de cabină, aproape de ușă e prima oprire)
și arată profilul lateral, procentul de umplere și sarcina pe axe. Dacă o axă trece de
limită, apare avertisment. Dimensiunile remorcii se completează pe fișa vehiculului; goale,
se folosește un standard EU 13,6 m. Produsele din depozit pot avea lungime/lățime/înălțime,
greutate unitară și zonă de picking.

### Teritorii

Pagina **Teritorii** grupează locațiile geocodate în N zone (implicit 5), ponderat pe volum,
kg și comenzi deschise. Poligoanele apar pe hartă; tabelul de echilibru arată abaterea față
de medie (țintă ≤ 15%). „Generează & aplică” scrie teritoriile și leagă locațiile; poți
previzualiza înainte.

### Cockpit + costuri + UIT (început P5)

Dashboard-ul arată un **cockpit operațional** pe ultimele 30 de zile: punctualitate
(opriri cu sosire reală), km plan vs. reali, cost estimat pe rute și comenzi livrate vs.
deschise. Costul se calculează din consum + preț combustibil, salariu, taxe, amortizare
și întreținere pe vehicul (sau default-urile firmei); dacă nu e completat nimic, totalul
rămâne gol — nu inventăm lei.

Pe Dispecerat, **Lansează** trece ruta în „lansată” și cere un UIT e-Transport. Până la
conectarea ANAF, UIT-ul e un stub local (cod `RO…` stabil pe rută); pe card apare badge-ul
UIT. Poți dezactiva cu `ETRANSPORT_MODE=off`. e-Factura SPV și importul tahograf rămân
neconectate — Finance spune asta onest.

### e-Factura UBL (local)

Pe Financiar, fiecare factură are **Descarcă UBL**: XML UBL 2.1 cu marcaj CIUS-RO,
gata de încărcat manual sau de legat mai târziu la SPV. Dacă lipsește CUI-ul firmei din
Setări, exportul refuză clar. Butonul „e-Factura SPV” tot explică că ANAF nu e conectat —
nu marcăm factura ca trimisă sau acceptată fără certificat.

### Import tahograf (.ddd)

Pe **Documente** poți încărca download-uri VU/card (`.ddd`, `.tgd`, `.c1b`, `.v1b`),
opțional legate de șofer și vehicul. Fișierul e arhivat cu hash; sistemul detectează tipul
(TLV) și poate ghici plăcuțe din textul ASCII. Nu calculează încă ore de conducere /
încălcări 561 — asta vine când avem decode complet de activități.

### Profil șofer + CMR către birou

Tab-ul **Profil** din app-ul de șofer nu mai rămâne pagină albă (lipseau iconițele) — poți vedea
statistici și te poți deconecta. Când șoferul încarcă un CMR, biroul primește notificare
„CMR de confirmat”, iar pe **Documente** apare lista CMR-urilor neconfirmate cu link la cursă.

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
