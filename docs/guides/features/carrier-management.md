# Flotă, șoferi și tarife

> În alte TMS-uri secțiunea se numește „carrier management”. În Transitix lucrezi cu **flota proprie**, **șoferii** și **tarifele comerciale** ale firmei — nu cu un marketplace de cărăuși externi.

## Cuprins

1. [Cum să… (index)](#cum-să--index)
2. [Cum adaug un vehicul](#cum-adaug-un-vehicul)
3. [Cum adaug un șofer](#cum-adaug-un-șofer)
4. [Cum aloc resurse pe o cursă](#cum-aloc-resurse-pe-o-cursă)
5. [Cum gestionez tarifele](#cum-gestionez-tarifele)
6. [Clasă vs MMA](#clasă-vs-mma)
7. [Documente care expiră](#documente-care-expiră)

---

## Cum să… (index)

- [Cum înregistrez un camion nou?](#cum-adaug-un-vehicul)
- [Cum leg șoferul de un cont de login?](#cum-adaug-un-șofer)
- [Cum pun șoferul pe cursă?](#cum-aloc-resurse-pe-o-cursă)
- [Cum definesc lei/km pe clasă?](#cum-gestionez-tarifele)

---

## Cum adaug un vehicul

**De ce:** fără vehicul nu poți aloca corect cursa și nu ai pe ce aplica tariful pe clasă.

1. Deschide **Flotă**.
2. Creează un vehicul nou.
3. Completează placa, marca/modelul, statusul.
4. Setează **clasa comercială** (ex. 10t) și **MMA** din talon, dacă le ai.
5. Completează datele de expirare ITP / RCA / etc.
6. Salvează.

`[SCREENSHOT: formular vehicul — evidențiază placa, clasa și MMA]`

## Cum adaug un șofer

**De ce:** App Șofer arată cursele doar pentru șoferul legat de contul autentificat.

1. Deschide **Șoferi**.
2. Creează profilul (nume, telefon, status activ).
3. Completează expirările: permis, medical, card tahograf.
4. Leagă **contul de utilizator** cu rol `driver` (contul e creat de admin din **Utilizatori**).
5. Salvează.

`[SCREENSHOT: formular șofer — evidențiază legătura cu user-ul]`

## Cum aloc resurse pe o cursă

**De ce:** alocarea e semnalul că șoferul trebuie să vadă și să execute misiunea.

1. Deschide cursa sau Dispeceratul.
2. Selectează vehiculul și șoferul.
3. Salvează / confirmă alocarea.
4. Verifică statusul **Alocată**.
5. Cere șoferului să reîmprospăteze App Șofer dacă nu apare imediat.

`[SCREENSHOT: alocare pe cursă — evidențiază dropdown-urile șofer și vehicul]`

Pe Dispecerat, alocarea poate fi la nivel de **rută** (mai multe opriri pe același camion).

## Cum gestionez tarifele

**De ce:** TPO-ul și verificările de date citesc tariful **valabil la data cursei**.

1. Deschide **Config. comercială**.
2. Adaugă un tarif nou pe clasă de vehicul.
3. Completează componentele (ex. tarif cursă, lei/km) conform ecranului.
4. Setează perioada de valabilitate.
5. Salvează **ca versiune nouă** — nu „strica” tariful vechi dacă ai deja curse pe el.
6. Configurează taxele de zonă pe **MMA** în secțiunea dedicată.

`[SCREENSHOT: listă tarife cu perioade — evidențiază valid_from / valid_to]`

## Clasă vs MMA

| Concept | Folosit la | Exemplu |
|---------|------------|---------|
| Clasă vehicul | Tarife comerciale | „10t” |
| MMA | Taxe de zonă | 19 000 kg |

Dacă amesteci cele două, factura și taxele nu mai coincid cu contractul.

## Documente care expiră

1. Completează datele de expirare pe vehicul și pe șofer.
2. Urmărește alertele pe **Dashboard** și în **Documente**.
3. Actualizează documentul înainte să expire — altfel riscul e operațional (control în trafic), nu doar „un warning în app”.

Import tahograf (fișiere `.ddd` etc.): din **Documente**. Statusul poate fi **parțial (TLV)** — nu înseamnă analiză completă Reg. 561.

---

## Vezi și

- [Ghid administrator](../user-guides/admin-guide.md)
- [Gestionarea curselor](shipment-management.md)
- [Glosar — TPO](../glossary.md#tpo)
