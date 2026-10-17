# 07. Flotă, șoferi, clienți

Trei ecrane cu aceeași logică: liste de fișe, cu **dezactivare în loc de ștergere**.

> **De ce nu se șterge nimic:** un vehicul șters ar rupe cursele istorice în care apare. Fișele
> dezactivate dispar din listele de alegere, dar rămân în rapoartele și facturile trecute.

## Flotă (vehicule)

Pentru fiecare vehicul: număr, marcă, model, șasiu, status, și două câmpuri care se confundă des:

| Câmp | Ce e | Unde se folosește |
|------|------|-------------------|
| **Clasă vehicul** | Banda comercială din contract, ex. „10t" | Alege **tariful** |
| **MMA (kg)** | Masa maximă autorizată din talon, ex. 19000 | Alege ce e **legal** |

Sunt lucruri diferite. Un camion cu MMA 19000 poate fi tarifat pe clasa 10t. Dacă le confunzi,
fie facturezi greșit, fie încarci ilegal.

**Statusuri vehicul:** Disponibil, În cursă, Mentenanță, Inactiv.

**Costuri** — completează-le, altfel marja pe cursă și „Cost estimat" din Dashboard rămân goale.

### Autoturisme (companion documente)

Ecranul **Autoturisme** (`/fleet`) e registrul de numere pentru taxa de zonă: MTMA din talon,
paginat (20 / 50 / 100 / 500). **Selectează toate** (deasupra listei) bifează tot ce se
potrivește filtrului, pe toate paginile; **Șterge selectate** le elimină pe toate. Util
pentru dubluri sau numere greșite din OCR. Dacă același număr apare pe un aviz nou, se
adaugă din nou. Confirmarea e obligatorie.

## Șoferi

Fișa șoferului: nume, telefon, status, documente (permis, atestate).

**Legătura cu contul de aplicație.** Un șofer poate avea un cont în aplicația de telefon. Legătura
se face din [Utilizatori](19-utilizatori.md). Fără ea, contul se autentifică într-o aplicație
goală: cursele se caută după această legătură.

**Statusuri șofer:** Disponibil, În cursă, În concediu, Indisponibil.

## Clienți

Datele de facturare, persoana de contact, adresa.

Clientul e cel de care se leagă **contractele** și, prin ele, **tarifele**. Vezi
[14. Configurare comercială](14-configurare-comerciala.md).

## Ce urmărim

- **Documente valabile pe toată flota** — zero alerte în Dashboard.
- **Clasa comercială completată pe fiecare vehicul.** Fără ea, TPO-ul n-are cum să aleagă tariful.
- **Costuri completate** — altfel nu poți vorbi despre marjă.
- **Fiecare șofer activ are contul legat de fișă**, dacă folosește aplicația.
- **Grad de utilizare a flotei** — vehicule în cursă față de total.

## Ce poate merge prost

- **Un vehicul nu apare la alegere pe rută:** e Inactiv sau în Mentenanță.
- **TPO fără linie de tarif:** vehiculul n-are clasă comercială, sau nu există tarif valabil
  pentru clasa lui la data cursei.
- **Șoferul spune că „nu vede nimic în aplicație":** contul lui nu e legat de fișa de șofer.
