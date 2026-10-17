# 06. Curse și CMR

## Ce face

Cursa e unitatea centrală. De ea se leagă CMR-ul, avizele, componentele TPO, factura, pozițiile
GPS și confirmarea clientului.

## Lista de curse

Caută după CMR, șofer, vehicul sau expeditor. Pentru fiecare cursă vezi traseul
(expeditor → destinatar), vehiculul, șoferul, încărcarea, **marja** și statusul.

## Statusurile

| Status | Ce înseamnă |
|--------|-------------|
| **De planificat** | Cursa există, nu e alocată nimănui |
| **Alocată** | Are șofer și vehicul |
| **Încărcată** | Marfa e în camion |
| **În tranzit** | Pe drum |
| **Livrată** | Descărcată la destinatar |
| **Problemă** | Ceva a mers prost — necesită intervenția dispecerului |
| **Anulată** | Nu se mai execută |

Statusul îl schimbă fie dispecerul, fie **șoferul din aplicație**, pe măsură ce avansează.

## Detaliul cursei

Un ecran, tot ce ține de cursa aceea:

### Marfă și traseu
Descrierea mărfii, greutate, colete, expeditor, destinatar, distanță.

### Venit / cost / marjă estimată
Ce aduce cursa față de ce costă. Marja e estimată — devine exactă când TPO-ul e calculat și
avizul confirmat.

### CMR
Două variante, care coexistă:

- **Poza CMR-ului de hârtie** — șoferul o încarcă din aplicație. OCR-ul rulează automat după
  upload și pre-completează ce poate. Cât timp rulează, scrie „Procesare OCR…"; dacă nu a putut
  citi, scrie „Datele OCR nu au fost extrase încă" — nu inventează câmpuri.
- **CMR digital** — documentul numerotat pe casete, completat în etape:
  **pre-completare** (din datele cursei) → **încărcare** (semnat la expeditor) →
  **livrare** (semnat la destinatar). Se poate tipări în format A4.

  Un CMR digital nesemnat **se tipărește vizibil nesemnat**. Nu există stare în care o foaie
  arată completă fără să fie.

### Cod UIT (e-Transport)
Codul declarației. Poate fi introdus manual — caz în care scrie explicit
**„Introdus manual — nu e generat de ANAF"** — sau generat de sistem, caz în care e un cod
simulat cu prefix `STUB-`.

### Avize legate
Avizele confirmate care aparțin cursei. Din ele se construiesc rapoartele și factura.

### Confirmare recepție client
Ce a confirmat destinatarul prin [portalul clientului](18-portal-client.md), inclusiv observațiile
și eventualele avarii semnalate.

## Ce urmărim

- **Fiecare cursă livrată are CMR semnat** — poză sau digital. Fără el, predarea mărfii n-are
  dovadă.
- **Fiecare cursă livrată are aviz confirmat și legat.** Un aviz nelegat nu ajunge pe nicio
  factură; sistemul îl semnalează.
- **TPO calculat pe fiecare cursă facturabilă.** O cursă fără TPO nu poate fi facturată — și
  ciorna de factură o refuză explicit, cu numele ei.
- **Marja pozitivă și stabilă** pe client și pe rută.
- **Zero curse rămase în „Problemă"** peste noapte.

## Ce poate merge prost

| Simptom | Cauză uzuală |
|---------|--------------|
| „Datele OCR nu au fost extrase încă" | Poza e neclară, sau nu e configurată cheia Vision. Completează manual. |
| Marja arată greșit | Costurile vehiculului nu sunt completate, sau TPO-ul nu e recalculat după o modificare a cursei. |
| Cursa nu apare în raport | Avizul nu e confirmat, sau nu e legat de cursă. |
| Distanța e 0 | Rutarea nu e configurată, sau o locație n-are coordonate. |
| CMR-ul digital nu se poate semna | Etapa anterioară nu e completă — nu se semnează livrarea înainte de încărcare. |
