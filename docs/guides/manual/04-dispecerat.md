# 04. Dispecerat și planificare

## Ce face

Transformă **comenzi** în **rute** și rutele în **curse**. E ecranul unde se decide ce camion
merge unde, în ce ordine și cu ce șofer.

## Cum lucrezi

### 1. Comenzi neplanificate

Coloana din stânga: tot ce a cerut clientul și n-a fost pus încă pe un camion. Caută după comandă
sau client.

### 2. Rută nouă

Apeși „Rută nouă", alegi **vehiculul** și **șoferul**, pui **ora de start**.

O rută fără vehicul sau fără șofer e permisă cât timp o construiești — se marchează „Fără vehicul"
/ „Fără șofer" — dar nu poate fi lansată așa.

### 3. Pui comenzile pe rută

Tragi comenzile din stânga în rută. Ordinea opririlor contează: o poți schimba cu „Mută mai sus" /
„Mută mai jos", sau scoate o comandă cu „Scoate de pe rută".

La fiecare schimbare, „Recalculează distanțele și ETA-urile" reface traseul și orele estimate.

### 4. Verifici încărcarea

„Plan de încărcare (profil remorcă)" arată cum se distribuie greutatea:

- **Axa față** și **axa spate**, cu limitele vehiculului.
- Avertisment dacă depășești capacitatea sau sarcina pe axă.

Asta e verificarea care ține camionul legal, nu doar plin. Detaliile în
[05. Încărcare și plan 2D](05-incarcare.md).

### 5. Lansezi ruta

„Lansează ruta + UIT":

- Se creează **cursele** din opriri.
- Se cere un **cod UIT** pentru e-Transport.

> **Atenție:** codurile UIT sunt deocamdată **simulate** și au prefixul `STUB-` pe cod. Nu sunt
> valabile la un control. Vezi [01. Concepte](01-concepte.md#ce-e-real-și-ce-e-simulat).

După lansare poți emite **CMR-urile rutei** și tipări **foaia de parcurs (PDF)**.

## Planning AI

Ecran separat (`/planning`). Rulează un optimizator peste comenzile deschise și propune scenarii.

- Fiecare scenariu arată **rute, distanță, durată, cost** și ce a rămas **nealocat**.
- Poți compara scenariile între ele înainte să alegi.
- Dacă optimizatorul nu e configurat (`VROOM_URL`), ecranul spune „Optimizatorul nu e gata de
  rulare" în loc să afișeze sugestii inventate.

Optimizatorul **propune**; dispecerul decide. Nimic nu se aplică automat.

## Ce urmărim

- **Zero comenzi rămase neplanificate** la sfârșitul zilei de planificare.
- **Grad de umplere ridicat** pe fiecare rută — camioane pline, nu multe camioane pe jumătate.
- **Nicio depășire de sarcină pe axă.** Asta nu e un obiectiv de optimizat, e o limită.
- **ETA-uri realiste**, verificabile apoi în [Tracking GPS](09-tracking-gps.md).
- **Kilometri pe comandă în scădere** — semnul că planificarea chiar grupează bine.

## Ce poate merge prost

- **Distanțele apar goale sau ETA lipsă:** rutarea nu e configurată (`OSRM_URL`). Poți planifica
  în continuare, dar ordinea opririlor n-are cum să fie evaluată automat.
- **Nu poți lansa ruta:** îi lipsește vehiculul, șoferul, sau o oprire n-are coordonate. Vezi
  [08. Locații](08-locatii-teritorii.md).
- **Ai lansat și vrei să modifici:** cursele există deja. Se modifică din
  [06. Curse](06-curse.md), nu retrăgând ruta.
