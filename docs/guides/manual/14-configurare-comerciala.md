# 14. Configurare comercială

> **Doar administrator.** Aici se decid banii: tot ce e configurat în acest ecran intră direct în
> valoarea fiecărei curse.

## Ce face

Adună într-un singur loc tot ce alimentează calculul TPO. Înainte, aceleași date se editau prin
ecrane generice, deci motorul de preț era configurabil doar de cine putea scrie SQL.

## Cele cinci secțiuni

### Tarife contractuale

Prețul agreat cu un client, pe o **clasă de vehicul**, valabil între două date.

| Câmp | Ce înseamnă |
|------|-------------|
| **Contract** | Contractul comercial de care ține tariful |
| **Clasă vehicul** | Banda comercială („10t"). **Nu MMA** — vezi [07. Flotă](07-flota-soferi-clienti.md) |
| **MMA de la / până la (kg)** | Restrângere opțională. Gol = se aplică oricărei clase |
| **Tarif cursă / tarif km** | Componentele de preț |
| **Km minimi facturabili** | Sub acest prag se facturează pragul |
| **Valabil de la / până la** | Gol la „până la" = deschis, fără termen |
| **Notă** | Actul adițional sau numărul anexei — de unde vine cifra |

**Perioadele care se suprapun nu sunt o eroare** — cea mai nouă câștigă. Dar sunt aproape
întotdeauna o dată de sfârșit uitată, așa că ecranul le semnalează.

**Istoricul** fiecărui tarif e vizibil: ce a fost înainte, de când.

### Zone și taxe

Definițiile zonelor și taxa aferentă fiecăreia. Intră direct în TPO ca linie separată.

### Taxe suplimentare

Servicii facturabile peste transport — de exemplu „Descărcare cu macara". Fiecare are:

- un **cod** (cel de pe aviz, ex. `DM`),
- o **sumă**,
- o **prioritate** — când mai multe se potrivesc, decide ordinea,
- o regulă de **potrivire textuală**, ca sistemul să le recunoască din observațiile avizului.

### Coduri observații

Codurile clientului, care traduc observațiile de pe aviz în taxe. Se pot **importa dintr-un
fișier Excel**, cu **previzualizare înainte de aplicare** — vezi ce se va întâmpla înainte să se
întâmple.

### Garaj

Punctul de plecare și întoarcere, din care se calculează kilometrii facturabili.

**Sistemul refuză o locație fără coordonate.** Fără ele nu se poate măsura drumul dus-întors, iar
TPO-ul și-ar pierde tăcut componenta de kilometri. Geocodează locația întâi, în
[08. Locații](08-locatii-teritorii.md).

Mutarea garajului se înregistrează în [jurnal](20-jurnal.md), cu numele locațiilor.

## Cum se construiește un TPO

```
Tarif cursă              (din tariful contractual valabil la data cursei)
+ Kilometri × tarif/km   (din traseul garaj → încărcare → descărcare → garaj)
+ Taxă zonă              (din teritoriul destinației)
+ Taxe suplimentare      (din codurile de observații de pe aviz)
─────────────────────────
= TPO
```

Totalul e **întotdeauna** suma acestor linii. Nu există un total scris separat care să conteze
mai mult.

## Ce urmărim

- **Zero curse fără tarif valabil.** Fiecare e o cursă facturată sub valoare.
- **Zero suprapuneri neintenționate** de perioade.
- **Fiecare tarif are notă** cu actul din care vine. Peste un an, o cifră fără proveniență nu se
  mai poate apăra.
- **Garaj setat și geocodat.**
- **Codurile de observații acoperă ce scriu clienții.** Un cod nerecunoscut e o taxă nefacturată.

## Ce poate merge prost

- **Un tarif nou nu se aplică** — data de început e după data cursei. Tariful se ia la data cursei.
- **Se aplică tariful vechi** — cel nou n-are dată de început, sau cel vechi n-are dată de sfârșit.
- **Taxa de macara nu apare** — codul de pe aviz nu e în lista de coduri observații.
