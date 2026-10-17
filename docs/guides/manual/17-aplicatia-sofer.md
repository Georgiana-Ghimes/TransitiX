# 17. Aplicația de șofer

## Ce face

Ce vede șoferul pe telefon. Se deschide în browser, nu se instalează din magazin.

Un cont de șofer vede **doar aplicația de șofer** — nu are acces la nimic din birou.

## Ce vede șoferul

### Cursele lui
Pentru fiecare: data, traseul, marfa, greutatea, coletele, instrucțiunile speciale.

### Progres cursă
Butoanele care mută cursa prin stări: încărcată → în tranzit → livrată. Ce apasă șoferul
actualizează imediat ce vede dispecerul.

### Navigare
Deschide traseul în aplicația de hărți a telefonului.

### CMR
Două posibilități:

- **Poza CMR-ului de hârtie.** O face cu telefonul; OCR-ul rulează automat după încărcare.
- **CMR digital**, completat și semnat pe ecran, în două momente: la **încărcare** (semnează
  expeditorul) și la **livrare** (semnează destinatarul).

### Chat dispecer
Mesaje directe cu biroul.

## Funcționarea fără semnal

Aceasta e partea care merită înțeleasă, fiindcă la ea se pierd cel mai ușor date.

**Ce apasă șoferul se salvează pe telefon și pleacă singur când prinde semnal.** Nu trebuie să
aștepte, nu trebuie să reintroducă nimic.

- Când salvează fără semnal, vede **„Salvat pe telefon — se trimite singur când prinzi semnal"**.
- La semnătură: **„Semnătura e pe telefon — se trimite singură când prinzi semnal"**.
- Lucrurile pleacă **în ordinea în care au fost făcute**. O semnătură de la încărcare nu poate
  ajunge după cea de la livrare.
- Trimiterea se reia **și când redeschide aplicația**, nu doar când revine semnalul. Cazul cel mai
  frecvent — închide telefonul într-o zonă moartă, îl deschide în oraș — n-are nicio tranziție de
  semnal, și tot funcționează.
- Dacă serverul **refuză** ceva (nu doar „n-am semnal"), acel element se **parchează** și se
  semnalează, în loc să fie reîncercat la infinit.

Telefonul poate fi dat altui șofer: fiecare element din coadă știe al cui e, deci semnăturile
unuia nu pleacă niciodată sub sesiunea altuia.

## Ce urmărim

- **Statusuri actualizate în timp real** — de ele depind punctualitatea și tracking-ul.
- **CMR semnat pe fiecare livrare.**
- **Coadă offline goală** la sfârșitul zilei. Ce a rămas parcat înseamnă ceva refuzat.
- **Poze CMR lizibile** — o poză bună înseamnă OCR bun, deci mai puțină muncă la birou.

## Ce poate merge prost

- **Aplicația e goală, deși are curse alocate:** contul nu e legat de fișa de șofer. Un
  administrator rezolvă în [19. Utilizatori](19-utilizatori.md).
- **Nu se vede pe hartă:** telefonul n-are permisiune de locație, sau cursa nu e pornită.
- **Ceva „parcat" în coadă:** serverul a refuzat. De obicei sesiunea a expirat de tot și trebuie
  reautentificare.
