# Glosar Transitix

## Cuprins

Termenii apar în ordine alfabetică. Fiecare explicație e în limbaj simplu.

---

## A

### Anexa Factura RAI

Șablon de export Excel agreat contractual (layout fix). Nu i se adaugă coloane noi din greșeală — pentru alte nevoi folosești alte preseturi de raport.

### Aviz

Document de însoțire a mărfii (ex. aviz de însoțire / cântar). În Transitix poți încărca avize în lot, rula OCR și le lega de curse. Șoferul poate trimite poze de tip „Aviz / cântar” din App Șofer.

---

## C

### CMR

*Convenția relativă la contractul de transport internațional de mărfuri* — în practică, **scrisoarea de transport**. În Transitix, numărul CMR identifică deseori cursa. Poate fi:

- **digital** — formular completat și semnat pe ecran;
- **scan** — poză / PDF încărcat (OCR pe birou).

Nu poți avea ambele „adevăruri” pe aceeași cursă: un scan blochează formularul digital.

### Configurație comercială

Modulul cu **tarife** (pe perioade de valabilitate), **zone**, **taxe**, **coduri de observații** și **garaj**. De aici vin calculele de TPO și taxele pe MMA.

### Cursă

O misiune de transport: de unde, unde, ce marfă, cine conduce, ce status are. Echivalentul uzual al „expediției” / „shipment” din alte TMS-uri.

### Clasă vehicul vs MMA

- **Clasă** (ex. „10t”) — pentru **tarife** comerciale.
- **MMA** (masa maximă autorizată) — pentru **taxe de zonă**.

Nu le înlocui una cu alta.

---

## D

### Dispecerat

Ecranul de lucru pe **zi**: comenzi neplanificate, rute, hartă, lansare, emitere CMR pe opriri. Complementar listei **Curse**.

### Document batch / lot

Grup de fișiere încărcate împreună (birou sau șofer). Trec prin OCR și revizuire înainte de confirmare.

---

## E

### e-Factura / UBL

În Transitix poți **descărca un fișier UBL 2.1 (CIUS-RO)** local pentru o factură. Asta **nu** înseamnă că factura a fost trimisă sau acceptată pe SPV ANAF. Trimiterea pe SPV necesită certificat și integrare ulterioară.

### e-Transport / UIT

Codul UIT asociat transportului de bunuri cu risc fiscal. În aplicație, la lansarea rutei, modul implicit poate genera un **cod stub local** (nu ANAF live), dacă e configurat așa pe server.

---

## G

### Garaj

Punctul de start/întoarcere folosit la km facturabili (tur-retur tipic: garaj → încărcare → descărcare → garaj).

### Geocodare

Transformarea unei adrese în coordonate pe hartă. Transitix folosește un furnizor gratuit și poate escalada la unul plătit (TomTom), dacă e configurat. Doar un om marchează adresa ca **verificată**.

---

## L

### Încărcare (plan pe rută)

Ecranul **Încărcare**: alegi un vehicul din flotă, o rută alocată lui, și vezi **profilul cu compartimente** plus **vederea laterală**. Așezarea e calculată (Ordine șofer / Ordine depozit), nu prin tragere pe desen.

Pas cu pas: [Ghid dispecer — plan pe rută](user-guides/dispatcher-guide.md#cum-văd-planul-de-încărcare-pe-o-rută-reală).

### LIFO (încărcare)

Ordinea „ultimul încărcat, primul descărcat”: opririle de livrare mai târzii se așază mai aproape de cabină / se încarcă primele. Folosită în ecranul **Încărcare** (butonul „Ordine șofer”).

### Plan 2D / Planificator 2D încărcare

Ecranul **Plan 2D**: desenul camionului (vedere de sus și lateral). Pui marfa pe desen prin **tragere cu mouse-ul** sau cu butonul **Plasează 1**. Poți rula **Auto load**, anula cu Undo, exporta planul. Nu înlocuiește ecranul **Încărcare** (acela calculează pe ruta reală din Dispecerat).

Pas cu pas: [Ghid dispecer — Plan 2D](user-guides/dispatcher-guide.md#cum-aranjez-marfa-pe-plan-2d-vizualizare-și-tragere).

---

## O

### OCR

Citirea automată a textului din scanuri/PDF-uri. La avize: încredere pe **câmp**, nu doar pe document. Câmpurile corectate manual nu sunt rescrise la o re-extragere.

### OSRM

Motor de rutare pe distanțe/timpi reali de drum. Planning AI și distanțele de cursă depind de el când e configurat. Fără OSRM, unele calcule rămân indisponibile (nu se inventează km).

---

## P

### Planning AI

Optimizare de rute pe baza matricii de distanțe și a constrângerilor (capacitate, timp). Rezultatul e un **scenariu**; abia **promovarea** îl transformă în rute de lucru în Dispecerat.

### POD (ePOD)

*Proof of Delivery* — dovadă de livrare: semnătură pe ecran și/sau foto, sau refuz documentat, pe oprirea din rută.

---

## R

### Replay

Redarea pe hartă a traseului planificat vs. urmei GPS reale pe o zi de rută.

---

## S

### Status cursă (valori uzuale)

| Cod | Etichetă UI |
|-----|-------------|
| `planificata` | De planificat |
| `alocata` | Alocată |
| `incarcata` | Încărcată |
| `in_tranzit` | În tranzit |
| `livrata` | Livrată |
| `problema` | Problemă |
| `anulata` | Anulată |

În App Șofer, fluxul tipic pe butoane: Alocată → Încărcată → În tranzit → Livrată.

---

## T

### Tahograf

Card / fișiere de activitate (`.ddd` etc.). Importul arhivează și scanează tipul (TLV). **Nu** generează automat încălcări Reg. 561 din fișierul brut.

### TPO

Identificator / calcul comercial pe cursă (linii de tarif, km, taxe). Verificările de date semnalează TPO fără tarif, total greșit, duplicate pe documente etc.

### Teritoriu

Zonă geografică generată sau gestionată pentru alocarea muncii (ex. clustere pe locații geocodate).

---

## U

### UIT

Vezi [e-Transport / UIT](#e-transport--uit).

---

## V

### Verificări date

Ecranul `/checks`: reguli cu consecințe clare (ex. cursă fără tarif → risc de subfacturare). **Erorile** pot ajunge în clopoțel; **avertismentele** rămân pe ecranul de verificări.

### VROOM

Solver de optimizare folosit de Planning AI, pe matricea de distanțe (nu pe un router separat).

---

## Vezi și

- [Introducere](introduction.md)
- [Depanare](troubleshooting.md)
