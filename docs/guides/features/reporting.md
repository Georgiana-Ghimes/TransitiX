# Rapoarte, avize și verificări

## Cuprins

1. [Cum să… (index)](#cum-să--index)
2. [Cum procesez un lot de avize](#cum-procesez-un-lot-de-avize)
3. [Cum generez Anexa / exportul din Avize](#cum-generez-anexa--exportul-din-avize)
4. [Cum folosesc ecranul Rapoarte](#cum-folosesc-ecranul-rapoarte)
5. [Cum citesc Verificări date](#cum-citesc-verificări-date)
6. [Ce nu se adună și ce rămâne gol](#ce-nu-se-adună-și-ce-rămâne-gol)

---

## Cum să… (index)

- [Cum scanez 20 de avize odată?](#cum-procesez-un-lot-de-avize)
- [Cum scot Anexa RAI?](#cum-generez-anexa--exportul-din-avize)
- [Cum re-descarc un export vechi?](#cum-folosesc-ecranul-rapoarte)
- [Cum aflu că lipsește tariful?](#cum-citesc-verificări-date)

---

## Cum procesez un lot de avize

**De ce:** OCR-ul pe lot îți dă o listă de revizuit, nu 40 de upload-uri izolate.

1. Deschide **Avize / Rapoarte**.
2. Încarcă fișierele (PDF/imagini) într-un lot.
3. Rulează extragerea.
4. Sortează după cele care **necesită revizuire** (încredere mică pe câmpuri).
5. Corectează greutatea brută, TPO, placa, cantitatea — **separat**; cantitatea nu înlocuiește cântarul.
6. Confirmă documentele complete.
7. Filtrează „De la șofer” dacă verifici doar pozele din cabină.

`[SCREENSHOT: Avize după OCR — evidențiază needs_review și greutatea brută]`

Corecțiile manuale sunt păstrate la re-extragere.

## Cum generez Anexa / exportul din Avize

**De ce:** clientul (ex. flux RAI) așteaptă un Excel pe layout-ul agreat.

1. Selectează documentele confirmate din listă.
2. Alege șablonul (ex. **Anexa Factura RAI** — layout blocat).
3. Generează / descarcă XLSX.
4. Citește **avertismentele** (ex. greutate care nu ajunge în coloanele șablonului).
5. Păstrează fișierul trimis clientului; istoricul din app poate permite re-descărcare identică.

`[SCREENSHOT: export Anexa — evidențiază șablonul ales și lista de avertismente]`

Nu lărgi Anexa RAI cu coloane noi din UI — folosește un **preset** / șablon separat pentru nevoi noi.

## Cum folosesc ecranul Rapoarte

**De ce:** `/reports` e constructorul modern: selecție pe criterii, preview, export cu **snapshot**.

1. Deschide **Rapoarte**.
2. Alege sursa / presetul (ex. centralizator greutăți, km și tarife).
3. Setează filtrele (perioadă, placă, status…). Un export fără criterii e refuzat.
4. Rulează **preview**. Verifică rândurile și totalurile.
5. Exportă.
6. Din **istoric**, re-descarcă același fișier — conținutul e cel de atunci, nu o recitire a documentelor corectate ulterior.
7. Dacă un document s-a schimbat după export, istoricul semnalează **drift**.

`[SCREENSHOT: Rapoarte — preview cu totaluri și avertismente — evidențiază butonul Export]`

## Cum citesc Verificări date

**De ce:** ecranul spune *ce strică factura*, nu doar „date incomplete”.

1. Deschide **Verificări date**.
2. Tratează întâi **erorile** (ex. cursă fără tarif, total TPO ≠ suma liniilor).
3. Deschide constatarea: citește consecința din catalog.
4. Corectează cauza în cursă / tarif / aviz.
5. Avertismentele (fără km, fără greutate, TPO duplicat…) le rezolvi pe același ecran.
6. Ascunde (dismiss) doar ce e rezolvat; cheia de dismiss include faptul care se schimbă, ca problema nouă să reapară.

`[SCREENSHOT: Verificări date — eroare trip_no_tariff — evidențiază textul de consecință]`

Clopoțelul din antet arată în principal **erorile**, ca să nu îngroape alertele de cursă.

## Ce nu se adună și ce rămâne gol

| Regulă | Motiv |
|--------|--------|
| Un **tarif lei/km** nu se sumează pe 10 rânduri | Media / rata nu e un total de bani |
| Lipsa greutății rămâne **celulă goală**, nu `0` | Zero arată ca „camion gol” pe foaia clientului |
| Anexa RAI poate **omite** greutatea | Layout contractual — app-ul te avertizează |

---

## Vezi și

- [Ghid dispecer](../user-guides/dispatcher-guide.md)
- [Glosar — Anexa Factura RAI](../glossary.md#anexa-factura-rai)
- [Depanare](../troubleshooting.md)
