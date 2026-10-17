# 01. Concepte și fluxul de bază

## Vocabularul

| Termen | Ce înseamnă în Transitix |
|--------|--------------------------|
| **Cursă** | O deplasare cu marfă, de la încărcare la descărcare. Unitatea centrală: aproape tot se leagă de o cursă. |
| **CMR** | Scrisoarea de transport internațional. În Transitix poate fi o poză a hârtiei sau un document digital semnat pe telefon. |
| **Aviz** | Avizul de însoțire a mărfii. Documentul clientului, cu ce marfă și câtă. Se încarcă scanat și se citește automat (OCR). |
| **TPO** | Tariful Pe Operațiune — valoarea unei curse. **Nu e un număr introdus cu mâna**, ci suma unor componente calculate: tarif cursă + kilometri + taxe de zonă + taxe suplimentare. |
| **Componentă TPO** | O linie din TPO: „Tarif cursă 500", „Kilometri 112 × 2,5", „Taxă zonă B 75", „Macara 120". |
| **Tarif contractual** | Prețul agreat cu un client, pe o clasă de vehicul, valabil între două date. |
| **Clasă vehicul** | Banda comercială din contract (ex. „10t"). **Nu e MMA.** Un camion cu MMA 19000 kg poate fi tarifat pe clasa 10t. |
| **Zonă / teritoriu** | Împărțirea geografică din care ies taxele de zonă. |
| **Garaj (depou)** | Punctul de plecare și întoarcere. Din el se calculează kilometrii facturabili. |
| **Etapă (leg)** | O bucată din traseu: garaj → încărcare, încărcare → descărcare, descărcare → garaj. |
| **UIT** | Codul e-Transport ANAF. În sistem e deocamdată **simulat** — vezi mai jos. |
| **Comandă** | Ce a cerut clientul, înainte să existe o cursă. Se planifică pe rute. |
| **Rută** | Un vehicul + un șofer + o listă de opriri într-o zi. Din ea ies cursele. |

## Fluxul, de la comandă la bani

```
Comandă client
      ↓  (Dispecerat: pui comanda pe o rută, alegi vehicul și șofer)
Rută planificată
      ↓  (Lansare rută → se emit cursele și CMR-urile)
Cursă
      ↓  (Șoferul încarcă, semnează CMR-ul, livrează, semnează la descărcare)
Cursă livrată
      ↓  (Se încarcă avizul; OCR-ul îi citește câmpurile; un om confirmă)
Aviz confirmat, legat de cursă
      ↓  (Motorul de preț descompune cursa în componente → TPO)
TPO calculat
      ↓  (Verificări date: prinde ce e greșit înainte să plece)
      ↓  (Rapoarte: anexa care pleacă la client)
      ↓  (Financiar: ciorna de factură, construită din componentele TPO)
Factură
```

## Trei reguli care explică multe comportamente

### Kilometrii facturabili sunt dus-întors din garaj

Nu distanța dintre încărcare și descărcare. Traseul facturabil e
**garaj → încărcare → descărcare(uri) → garaj**, calculat pe etape.

De aceea mutarea garajului schimbă tăcut toți kilometrii calculați de atunci înainte — și de aceea
mutarea lui se înregistrează în jurnal.

### Tariful se ia „la data cursei", nu la data facturii

Dacă un tarif s-a schimbat pe 1 martie și facturezi în aprilie o cursă din februarie, se aplică
tariful din februarie. Peste tot în sistem, căutarea unui tarif e „valabil la data efectuării
cursei".

### Totalul e întotdeauna suma liniilor

Nicăieri nu există un „total TPO" scris separat care să conteze mai mult decât componentele.
Dacă cele două nu se potrivesc, sistemul îți spune — și facturează componentele, fiindcă ele sunt
ce a calculat motorul.

## Ce e real și ce e simulat

Onestitate despre stadiul integrărilor, ca să nu iei o simulare drept realitate:

| Funcție | Stare |
|---------|-------|
| OCR pe avize și CMR | **Real** când există cheie Google Vision. Fără ea, PDF-urile cu text se citesc oricum; imaginile trebuie completate manual. |
| Rutare (kilometri reali pe șosea) | **Real** când `OSRM_URL` e configurat. **La voi nu e configurat momentan**, deci `/api/geo` răspunde „indisponibil" în loc de o distanță inventată — iar TPO-ul nu are componenta de kilometri. |
| Geocodare (adresă → punct pe hartă) | **Real** când `PHOTON_URL` sau TomTom sunt configurate. |
| Email | **Real** cu Resend. Fără el, mesajele se scriu în jurnalul serverului, iar linkurile (invitație, resetare parolă) se arată în interfață ca să le poți trimite manual. |
| e-Factura ANAF | **Simulare.** Se generează XML local, nu se trimite nimic la SPV. |
| e-Transport (UIT) | **Simulare.** Codurile au prefixul `STUB-` **pe cod**, ca să nu poată fi confundate cu unele reale la un control în trafic. |
| Planning AI | **Real** cu VROOM configurat; altfel sugestii demonstrative, marcate ca atare. |
| Tracking GPS | Real pentru pozițiile primite de la aplicația de șofer sau de la un furnizor de telematică. Sursa „simulate" e demonstrativă și e afișată ca atare. |
