# 12. Rapoarte

## Ce face

Construiește foaia care pleacă la client: alegi coloanele, alegi cursele, previzualizezi, exporți.

## Cum lucrezi

### 1. Pornești de la un preset sau de la zero

Presetul e un aranjament de coloane deja agreat cu un client:

| Preset | Pentru ce |
|--------|-----------|
| **Anexa Factura RAI** | Anexa contractuală RAI, 14 coloane, în ordinea agreată. **Blocată** — nu se modifică, fiindcă ordinea e parte din contract. |
| **Centralizator Baumit — greutăți** | Livrări cu greutate brută și netă pe fiecare aviz, pentru verificare cu cântarul. |
| **Centralizator km și tarife** | Kilometri, tarif și valoare pe cursă, pentru decontul lunar. |

Poți porni de la un preset și-l modifici (dacă nu e blocat), sau construiești de la zero.

### 2. Alegi coloanele

Sursele disponibile sunt grupate: **identificare**, **cursă**, **marfă**, **greutate**,
**comercial**, **meta**.

Fiecare sursă știe singură ce fel de date conține, iar din asta rezultă:

- **cum se formatează** — o dată apare ca dată, o sumă cu două zecimale;
- **dacă se poate aduna** pe totaluri.

> **Tarifele nu se însumează niciodată.** Suma coloanei „tarif/km" e o cifră fără sens. Cantitățile
> se adună; ratele nu.

### 3. Alegi cursele

După perioadă, client, status. Sistemul **refuză o selecție goală** — adică refuză să exporte
toată arhiva din greșeală.

### 4. Previzualizezi

Vezi exact ce va conține fișierul, plus **avertismentele**:

| Avertisment | Ce înseamnă |
|-------------|-------------|
| Aviz neconfirmat | Un document din selecție n-a fost verificat de un om |
| Necesită revizie | OCR nesigur, necorectat |
| Fără TPO | Cursa n-are valoare calculată |
| Fără dată | Lipsește data efectuării |
| Fără dată facturare | Lipsește data de facturare |
| Fără greutate brută | Nu se poate confrunta cu cântarul |
| Greutate neexportată | Există greutate dar nu e pe nicio coloană |
| TPO duplicat | Același număr pe mai multe documente |

Avertismentele nu opresc exportul. Îți spun ce trimiți.

### 5. Exporți

XLSX descărcat, trimis pe email, sau arhivă ZIP cu documentele atașate.

### Un detaliu care contează

**Un câmp lipsă rămâne gol, nu zero.** O cântărire care lipsește, tipărită ca „0", se citește ca
un camion care a plecat gol. Gol înseamnă „nu știm"; zero înseamnă „nimic". Sunt lucruri diferite.

## Data facturării

Din ecran poți **ștampila în masă data de facturare** pe un set de curse. Această operațiune
**nu atinge niciodată data efectuării cursei** — sunt două date distincte, și confuzia dintre ele
mută curse dintr-o lună în alta.

## Istoricul exporturilor

Fiecare export se salvează **cu rândurile lui**, nu doar cu numele fișierului. Poți:

- vedea ce s-a trimis, când, de cine și către cine;
- **re-descărca fișierul exact cum a plecat** — chiar dacă datele s-au corectat între timp.

Asta e ce face posibil răspunsul la „ce anume ne-ați trimis în martie?".

## Ce urmărim

- **Zero avertismente** pe un export care pleacă la client.
- **Raport trimis la termen**, în fiecare perioadă de decont.
- **Zero reveniri** cu „cifra nu se potrivește" — fiecare revenire înseamnă ceva ce verificările
  ar fi trebuit să prindă.
- **Fiecare export re-descărcabil.**

## Ce poate merge prost

- **Coloane goale în masă** — sursa aleasă nu e completată pe avizele din perioadă.
- **Totaluri care nu se potrivesc cu factura** — factura se face din componentele TPO, raportul din
  avize. Dacă diferă, [Verificări date](13-verificari.md) spune de ce.
- **Nu poți exporta** — selecția e goală. Lărgește perioada sau filtrele.
