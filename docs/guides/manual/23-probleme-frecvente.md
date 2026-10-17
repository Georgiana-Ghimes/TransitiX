# 23. Probleme frecvente

## Nu pot intra în cont

| Situație | Ce faci |
|----------|---------|
| Am uitat parola | „Am uitat parola" pe ecranul de autentificare. Link valabil o oră |
| Linkul de invitație a expirat | Cere unui administrator „Retrimite invitația" |
| Parola nu e acceptată | Minimum 10 caractere, fără cuvinte evidente, fără propriul email sau nume |
| „Cont dezactivat" | Un administrator ți-a oprit contul. Doar el îl poate reactiva |
| Am fost delogat brusc | Ți s-a schimbat rolul, sau cineva a încheiat toate sesiunile |

## Cifre care nu ies

### Cursa n-are kilometri
Ori rutarea nu e configurată (`OSRM_URL` — **la voi nu e**, momentan), ori o locație de pe traseu
n-are coordonate. Vezi [08. Locații](08-locatii-teritorii.md).

### TPO-ul e mai mic decât ar trebui
Cel mai probabil lipsește o componentă. [13. Verificări date](13-verificari.md) îți spune care:
tarif inexistent la data cursei, kilometri lipsă, sau o taxă suplimentară nerecunoscută.

### Se aplică tariful greșit
Tariful se ia **la data efectuării cursei**, nu la data facturii. Verifică perioadele de
valabilitate în [14. Configurare comercială](14-configurare-comerciala.md) — de obicei e o dată de
sfârșit uitată pe tariful vechi.

### Raportul și factura nu dau la fel
Raportul se construiește din avize, factura din componentele TPO. Diferența e reală și
[13. Verificări](13-verificari.md) o numește.

### Factura refuză să se emită
„Cursa nu are TPO calculat". Sistemul refuză să inventeze o cifră. Calculează TPO-ul întâi.

### O coloană e goală în raport
Nu e o eroare de export: câmpul chiar lipsește pe avize. **Gol înseamnă „nu știm", nu „zero"** —
o cântărire lipsă tipărită ca 0 s-ar citi ca un camion plecat gol.

## Documente și OCR

### OCR-ul n-a citit nimic
Scanare de proastă calitate sau layout nou. Completează manual — **corectura ta rămâne
definitivă** și nu va fi suprascrisă de o re-extragere.

### Documentul nu iese din „Extras"
Un câmp obligatoriu e încă necompletat.

### Am corectat, dar tot apare greșit
Verifică dacă ai corectat coloana vizibilă *și* ai salvat. Dacă persistă, e de raportat.

## Aplicația de șofer

### Șoferul nu vede nicio cursă
Contul lui nu e legat de fișa de șofer. Un administrator rezolvă în
[19. Utilizatori](19-utilizatori.md).

### Nu apare pe hartă
Telefonul n-are permisiune de locație, sau cursa nu e pornită din aplicație.

### „Se trimite când prinzi semnal" și nu s-a trimis
Se reia și la redeschiderea aplicației, nu doar la revenirea semnalului. Dacă un element rămâne
**parcat**, serverul l-a refuzat — de obicei sesiunea a expirat complet și trebuie reautentificare.

## Administrare

### Nu pot dezactiva un utilizator
E ultimul administrator activ, sau ești chiar tu. Promovează pe altcineva întâi.

### Nu pot schimba un rol
Nu-ți poți schimba propriul rol. Cere altui administrator.

### Am dezactivat un cont, dar persoana încă lucrează
Sesiunile s-au închis, deci nu se mai poate reînnoi — dar o sesiune deja deschisă mai
funcționează **cel mult 30 de minute**. Ecranul îți spune asta la dezactivare.

### Nu găsesc un vehicul / șofer / client
Probabil e dezactivat. Fișele nu se șterg, ca să nu rupă istoricul — dispar din listele de alegere.

## Lucruri care par defecte și nu sunt

| Ce vezi | De ce e intenționat |
|---------|---------------------|
| „Punctualitate —" | Nu există sosiri reale. Nu se inventează o cifră din plan |
| „Cost estimat —" | Nu ai completat costurile pe vehicul |
| „Optimizatorul nu e gata de rulare" | VROOM nu e configurat. Mai bine decât sugestii inventate |
| Cod UIT cu `STUB-` | E simulat, nu ANAF. Prefixul e pe cod ca să nu poată fi confundat la un control |
| „Export local · SPV off" | e-Factura nu se trimite la ANAF |
| Poziții GPS mai vechi de 90 de zile lipsesc | Se șterg automat. Ultima poziție și kilometrii realizați rămân |
| O celulă goală în loc de 0 | „Nu știm" și „zero" sunt lucruri diferite |
| Un CMR tipărit vizibil nesemnat | O foaie nu poate arăta completă fără să fie |

## Când raportezi o problemă

Spune:

1. **Versiunea** — stânga jos (ex. `v1.15.2`).
2. **Ce ecran** și ce ai apăsat.
3. **Ce ai așteptat** și ce s-a întâmplat.
4. **Ora aproximativă** — fiecare cerere are un identificator în jurnalul serverului, iar ora
   restrânge căutarea la câteva linii.

Dacă ai un mesaj de eroare pe ecran, copiază-l întreg.
