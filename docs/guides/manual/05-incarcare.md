# 05. Încărcare și plan 2D

## Ce face

Răspunde la două întrebări diferite:

- **Încărcare** (`/loading`) — *ce* marfă intră în ce vehicul, pe ce oprire.
- **Plan 2D** (`/load-planner`) — *unde anume* stă marfa în remorcă.

## Încărcare

Ecranul are trei zone:

- **Flotă** — vehiculele, cu căutare după număr, marcă, model sau șasiu.
- **Nealocate** — articolele care n-au intrat încă în niciun vehicul.
- **Articole încărcate** — ce e deja în vehiculul selectat, grupat **pe opriri**.

Pentru fiecare articol vezi comanda din care vine, cantitatea și greutatea.

**Profilul vehiculului** arată distribuția pe **axa față** și **axa spate** și te avertizează
înainte să depășești.

## Plan 2D

Aranjarea efectivă în remorcă, văzută de sus. Serveste la:

- verificarea că marfa **încape** fizic, nu doar la greutate;
- ordinea de descărcare — ce se descarcă primul trebuie să fie accesibil;
- distribuția greutății între axe.

## Ce urmărim

- **Grad de umplere** — volum și greutate folosite din cât permite vehiculul.
- **Sarcină pe axă în limite.** Depășirea e amendă și e periculoasă.
- **Ordine de descărcare corectă** — marfa primei opriri accesibilă prima. Altfel șoferul
  descarcă și reîncarcă la fiecare oprire.
- **Zero articole nealocate** la plecare.

## Ce poate merge prost

- **„Nicio rută alocată acestui vehicul"** — vehiculul n-are rută pe ziua aleasă. Întâi
  [Dispecerat](04-dispecerat.md).
- **„Nimic încărcat"** deși există comenzi — articolele n-au fost trase în vehicul.
- **Greutăți care nu se adună** — de obicei o comandă fără greutate completată. Se vede în
  [Verificări date](13-verificari.md).
