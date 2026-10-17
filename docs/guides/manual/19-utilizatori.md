# 19. Utilizatori și acces

> **Doar administrator.**

## Ce face

Invitații, conturi adăugate manual, roluri, dezactivare. Ecranul e în **Setări › Utilizatori**
(pe Transitix complet și ca pagină separată). Înainte, toate astea se făceau direct în baza de
date — deci doar de cine avea acces tehnic, fără urmă și cu parola aleasă de altcineva.

## Două reguli care explică tot ecranul

### Nimeni nu rămâne cu parola aleasă de altcineva

Inviți pe cineva → primește un link → **își alege singur parola**. Tu nu o afli niciodată.

Dacă adaugi pe cineva **manual**, îi dai o parolă **temporară**. La prima autentificare aplicația
îl obligă să și-o schimbe — până atunci nu poate deschide nimic altceva (blocajul e pe server,
nu doar pe ecran).

Un administrator care ar ști parola de zi cu zi a unui coleg o știe pentru totdeauna, iar
[jurnalul](20-jurnal.md) nu-i mai poate deosebi pe cei doi.

### Conturile se dezactivează, nu se șterg

Un cont șters ar goli exact coloana care spune cine ce a făcut, în tot istoricul. Dezactivarea
scoate persoana din sistem și păstrează istoria.

## Cum lucrezi

### Inviți (varianta recomandată)

„Invită coleg" → nume, email, telefon (opțional), rol. Se trimite un email (Resend) cu link
valabil **7 zile**. Emailul poate fi al firmei sau personal (Gmail etc.). Dacă adresa e Gmail,
persoana poate intra direct cu **„Autentifică-te cu Google”**, fără să mai deschidă linkul.

Fără serviciu de email configurat — sau dacă trimiterea a eșuat — linkul apare pe ecran cu buton
de copiere; e singura cale să ajungă la om. Ecranul afișează permanent un avertisment cât timp
emailul nu e configurat.

### Adaugi manual un angajat

„Adaugă manual" → aceleași câmpuri, plus o **parolă temporară** (minimum 10 caractere). Lasă
câmpul gol și sistemul generează una ușor de citit (fără 0/O, 1/l/I).

- Parola generată **se afișează o singură dată**. Dă-o persoanei direct (față în față, telefon),
  nu pe un grup.
- Contul apare cu starea **Creat manual** și mesajul „Are parolă temporară”.
- La prima autentificare persoana ajunge pe „Alege-ți parola”. După schimbare, orice sesiune
  deschisă cu parola temporară se închide.
- Parola temporară nu apare niciodată în jurnal.

Folosește varianta asta doar când invitația nu e posibilă (fără acces la email în ziua respectivă).

### Avertismentele formularului

| Mesaj | Ce faci |
|-------|---------|
| „@gmail.com este o adresă personală…” | Verifică încă o dată că adresa e a persoanei potrivite |
| „Adresa e pe @alta.ro, nu pe @firma.ro” | Corect pentru colaboratori externi; altfel verifică adresa |
| „Adresa este deja folosită de un cont din altă firmă” | O adresă = un cont în tot sistemul. Folosește altă adresă |
| „Există un cont dezactivat cu acest email” | Reactivează contul existent în loc să creezi altul |
| „Parola temporară: …” | Parola aleasă nu respectă regula; lasă câmpul gol ca s-o genereze sistemul |

### Starea fiecărui cont

| Stare | Ce înseamnă |
|-------|-------------|
| **Activ** | S-a autentificat cel puțin o dată |
| **Invitat** | Are invitație validă, nu și-a ales încă parola |
| **Creat manual** | Adăugat cu parolă temporară, nu s-a autentificat încă. Poți și „Retrimite invitația" dacă vrei să-și aleagă parola din email |
| **Invitație expirată** | Nu s-a autentificat niciodată și linkul nu mai e valabil → „Retrimite invitația" |
| **Dezactivat** | Nu mai poate intra |

### Schimbi rolul

Selectorul de rol de pe rând. La schimbare, **toate sesiunile persoanei se închid** — token-ul
vechi încă spunea rolul vechi.

### Dezactivezi

„Dezactivează". Sesiunile se închid imediat, deci contul nu se mai poate reînnoi.

**Sistemul îți spune și cât mai poate lucra o sesiune deja deschisă** — cel mult 30 de minute,
până expiră token-ul curent. Nu-ți lasă impresia că tăierea e instantanee.

### Legi contul de șofer la fișa de șofer

Pentru conturile cu rol **Șofer**. Fără legătură, contul se autentifică într-o aplicație goală:
cursele se caută prin această legătură.

Dacă fișa de șofer are deja același email, legătura se face **automat** la invitare. Altfel,
alege-o din listă. Ecranul semnalează conturile de șofer nelegate.

## Ce nu poți face, și de ce

| Blocaj | Motiv |
|--------|-------|
| Nu-ți poți schimba propriul rol | Un administrator care se retrogradează din greșeală nu mai poate reveni |
| Nu-ți poți dezactiva propriul cont | Același motiv |
| Nu poți adăuga o adresă folosită deja în altă firmă | Autentificarea caută adresa în tot sistemul; două conturi cu aceeași adresă ar bloca unul dintre ei |
| Nu poți retrograda sau dezactiva **ultimul administrator activ** | Firma ar rămâne fără acces la utilizatori, tarife și jurnal. Singura cale înapoi ar fi intervenția tehnică |

Când există un singur administrator, ecranul o spune explicit și butoanele care ar strica lucrul
sunt dezactivate — nu-ți oferă un buton care oricum ar eșua.

## Ce urmărim

- **Fiecare persoană are contul ei.** Conturile partajate fac jurnalul inutil.
- **Cel puțin doi administratori.** Unul singur e un punct unic de blocaj.
- **Zero conturi active ale unor oameni plecați din firmă.**
- **Zero conturi de șofer nelegate.**
- **Zero invitații expirate** neurmărite — cineva așteaptă să poată lucra.
- **Zero conturi „Creat manual” mai vechi de câteva zile** — parola temporară circulă încă.
- **Invitații în loc de conturi manuale** ori de câte ori persoana are acces la email.
- **Rolul minim necesar** pe fiecare persoană.

## Securitate

- Sistemul **nu returnează niciodată** parole, hash-uri sau coduri de resetare, nici măcar către
  administrator.
- Fiecare acțiune din acest ecran intră în [jurnal](20-jurnal.md).
- Autentificările eșuate pe un cont real se înregistrează — o serie de eșecuri pe același cont e
  un semnal.
