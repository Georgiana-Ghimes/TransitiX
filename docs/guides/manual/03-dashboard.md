# 03. Dashboard

## Ce face

Prima pagină după autentificare. Răspunde la „ce se întâmplă azi și ce cere atenție", fără să
deschizi nimic altceva.

## Ce vezi

### Cartonașele de sus

| Indicator | Ce numără | De ce contează |
|-----------|-----------|----------------|
| **Vehicule** | Total în flotă | Baza de comparație pentru gradul de utilizare |
| **Șoferi** | Activi | Câți oameni poți programa efectiv mâine |
| **Curse active** | În desfășurare | Cât e în aer acum |
| **Alerte** | Documente expirate | Riscul legal imediat: un camion cu ITP expirat nu are ce căuta pe drum |

### Cockpit operațional

Pe o perioadă aleasă (implicit ultimele 30 de zile):

- **Punctualitate** — procentul opririlor ajunse la timp, calculat din sosirile reale.
  Arată „—" până când există sosiri reale înregistrate; nu se inventează o cifră din plan.
- **Km plan vs real** — diferența dintre kilometrii planificați și cei parcurși efectiv.
  O diferență mare și constantă înseamnă fie rute prost planificate, fie ocoluri nejustificate.
- **Cost estimat** — apare doar dacă ai completat costurile pe vehicul. Altfel spune exact asta,
  în loc să afișeze zero.
- **Comenzi** — câte sunt deschise în perioadă.

### Curse după status

Distribuția curselor pe cele șapte stări. Citirea utilă e forma, nu cifrele:
multe curse blocate în „Încărcată" înseamnă că cineva nu marchează plecarea; multe în „Problemă"
înseamnă ceva sistemic.

### Documente expirate

Lista scurtă a documentelor care au expirat sau expiră curând, cu „Vezi toate" spre ecranul
Documente.

### Curse recente

Ultimele curse cu CMR, șofer, vehicul, traseu și status. Click pe o cursă o deschide.

## Ce urmărim

- **Alerte = 0.** Orice altceva e un risc de amendă sau de imobilizare.
- **Punctualitate în creștere**, sau cel puțin stabilă. Scăderea bruscă precede reclamațiile.
- **Km plan vs real apropiați.** Diferența e bani cheltuiți pe care nu i-a cerut nimeni.
- **Nicio cursă blocată** într-un status intermediar mai mult de o zi.

## Ce poate merge prost

- **„Punctualitate —"** înseamnă că nu există sosiri reale înregistrate: fie șoferii nu marchează
  statusul din aplicație, fie nu sunt configurate poziții GPS.
- **„Km plan vs real: 0 km"** apare când rutarea nu e configurată (`OSRM_URL`). Nu e o eroare de
  date, e o funcție oprită.
- **„Cost estimat —"** înseamnă că nu ai completat costurile pe vehicul, în Flotă.
