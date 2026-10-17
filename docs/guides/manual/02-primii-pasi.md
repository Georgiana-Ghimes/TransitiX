# 02. Primii pași: cont, roluri, parole

## Firmă nouă: îți faci singur cont

„Creează unul” pe ecranul de autentificare (dacă serverul permite înregistrarea):

1. Alegi **Email de firmă** (ex. `nume@firma.ro`) sau **Email personal** (Gmail, Yahoo, Outlook…),
   ori apeși direct **„Înregistrează-te cu Google”**.
2. Completezi numele firmei, numele tău și parola. Devii **administratorul** firmei.
3. Primești un **email de confirmare** (link valabil **48 de ore**). Până nu-l deschizi, nu te poți
   autentifica; din ecranul de autentificare poți cere alt link (cel mult o dată pe minut).
   Contul Google nu are nevoie de confirmare — Google a verificat deja adresa.

Mesajele formularului:

| Mesaj | Ce înseamnă |
|-------|-------------|
| „@gmail.com este o adresă personală, nu a firmei” | Ai ales „Email de firmă” cu o adresă personală. Schimbă tipul sau adresa |
| „Colegi de pe @firma.ro folosesc deja Transitix” | Firma ta are probabil deja cont. Cere o invitație administratorului. Dacă e totuși o firmă separată, bifezi confirmarea |
| „Există deja un cont cu această adresă” | Autentifică-te sau folosește „Ai uitat parola?” |
| „Înregistrarea de conturi noi este oprită pe acest server” | Serverul acceptă doar invitații |

> Fără serviciu de email configurat, linkul de confirmare îți apare direct pe ecran.

## Cum intri într-o firmă existentă

Primești un **email cu un link de invitație**. Nu primești o parolă — nimeni din firmă,
nici administratorul, nu îți alege parola. Deschizi linkul, îți alegi singur parola, gata.

Linkul e valabil **7 zile**. Dacă a expirat, cere unui administrator să apese „Retrimite
invitația" în ecranul Utilizatori.

> Dacă firma nu are serviciul de email configurat, administratorul vede linkul pe ecran și ți-l
> trimite cum poate. Este același link.

Dacă invitația e pe o adresă Gmail, poți intra direct cu **„Autentifică-te cu Google”**.

Dacă administratorul **te-a adăugat manual**, primești de la el o **parolă temporară**. La prima
autentificare ești dus pe „Alege-ți parola” și nu poți folosi aplicația până nu o schimbi.

## Parola

Regula, afișată și pe ecran înainte să tastezi:

- **Cel puțin 10 caractere.**
- **Fără obligație de majuscule, cifre sau simboluri.** Intenționat: o frază lungă („trei camioane
  pleaca marti") e mai greu de ghicit decât „Parola1!", și mai ușor de ținut minte.
- Nu poate fi ceva evident (`parola…`, `password…`, `qwerty…`, `administrator`).
- Nu poate fi propriul tău email sau nume.
- Fără spațiu la început sau la sfârșit — de obicei e o greșeală de copy-paste care te blochează
  la următoarea autentificare tastată de mână.

Ai uitat parola: „Am uitat parola" pe ecranul de autentificare. Primești un link valabil o oră.

## Rolurile

| Rol | Ce poate |
|-----|----------|
| **Administrator** | Tot: utilizatori, tarife, jurnal de modificări, setările firmei. |
| **Dispecer** | Curse, planificare, documente, avize. Fără configurare comercială și fără utilizatori. |
| **Financiar** | Facturi, rapoarte, avize. Fără dispecerat. |
| **Șofer** | Doar aplicația de șofer, pe telefon. Nu vede biroul. |

Rolul se schimbă doar de un administrator, din **Utilizatori**. Când ți se schimbă rolul, ești
delogat automat — token-ul vechi încă spunea rolul vechi.

## Sesiuni

- Rămâi autentificat **7 zile** fără să reintroduci parola.
- Din **Setări** vezi sesiunile active (telefon, laptop, tabletă) și le poți încheia pe toate
  deodată — util dacă ai pierdut un telefon. Te deloghează **și pe dispozitivul curent**.
- Când un administrator îți dezactivează contul, sesiunile se închid imediat. O sesiune deja
  deschisă mai poate lucra cel mult **30 de minute**, până expiră token-ul curent.

## Ce vezi în stânga jos

Versiunea aplicației (ex. `v1.15.2`). Când raportezi o problemă, spune și versiunea — scutește
jumătate din discuție.
