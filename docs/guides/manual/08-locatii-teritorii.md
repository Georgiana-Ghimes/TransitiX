# 08. Locații și teritorii

## De ce contează acest ecran mai mult decât pare

**Din coordonate ies kilometrii, iar din kilometri ies banii.** O locație fără punct pe hartă nu
poate fi rutată, deci cursa care trece prin ea n-are componentă de kilometri în TPO. O locație cu
punctul pus greșit produce kilometri greșiți, care se facturează greșit — și nimeni nu observă,
fiindcă cifra arată plauzibil.

## Locații

Lista adreselor: puncte de încărcare, descărcare, garaje. Caută după nume, adresă sau oraș.

### Geocodarea și nivelurile de încredere

Când salvezi o adresă, sistemul încearcă să găsească punctul pe hartă. Rezultatul are un scor de
**încredere**, și de el depinde ce se întâmplă:

| Încredere | Ce face sistemul |
|-----------|------------------|
| **peste 0,8** | Punctul se salvează și se consideră bun |
| **între 0,45 și 0,8** | Punctul se salvează, dar rămâne **neverificat** — cineva trebuie să se uite |
| **sub 0,45** | **Nu se salvează nimic.** O adresă ghicită prost e mai rea decât una lipsă |

Asta e regula care merită reținută: sistemul preferă o locație vizibil incompletă în locul uneia
plauzibil greșite.

### Ce faci în ecran

- Vezi punctele pe hartă, cu nivelul de încredere.
- **Variante găsite** — când geocoderul a propus mai multe, alegi tu.
- **Tragi pinul** pe poziția corectă, dacă e greșit. O poziție pusă de om nu mai e suprascrisă
  automat.
- Vezi **sursa** (ce serviciu a găsit punctul) și coordonatele exacte.

Dacă geocoderul nu e configurat, ecranul spune „Geocoderul nu este configurat" — coordonatele se
pot pune manual.

## Teritorii

Împărțirea geografică pe zone. Din ea ies **taxele de zonă**, care sunt o componentă directă din
TPO. Vezi [14. Configurare comercială](14-configurare-comerciala.md).

## Ce urmărim

- **Zero locații active fără coordonate.** Fiecare e o cursă care nu se poate ruta.
- **Zero locații neverificate** care apar frecvent în curse. Cele rare pot aștepta; cele zilnice nu.
- **Garajul are coordonate.** Sistemul refuză să seteze ca garaj o locație negeocodată — fără
  coordonate nu există kilometri facturabili deloc.

## Ce poate merge prost

- **O cursă cu distanță 0** — o locație de pe traseu n-are punct.
- **Kilometri sistematic prea mari pe un client** — probabil un pin pus greșit, la câțiva zeci de
  km de adresa reală.
- **Nu poți seta garajul** — locația aleasă n-are coordonate. Geocodeaz-o întâi, aici.
