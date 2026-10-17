# 20. Jurnal de modificări

> **Doar administrator.** Istoricul unei singure înregistrări e vizibil întregului birou — de ce
> arată o cursă așa e parte din muncă, nu auditul unui coleg.

## Ce face

Răspunde la „cine a schimbat asta, când, și din ce în ce". Întrebarea se pune de obicei peste luni,
de cineva care n-a fost în cameră.

## Ce vezi

Evenimentele grupate **pe zile**, cele mai recente primele. Fiecare linie arată ora, tipul acțiunii,
ce s-a atins, numele înregistrării, cine a făcut-o și de la ce adresă IP.

**Click pe o linie** deschide câmpurile care s-au mutat: **vechi → nou**.

Filtrezi după tip, acțiune, utilizator, perioadă, sau cauți după nume.

## Ce se înregistrează

Configurarea comercială (contracte, tarife, taxe de zonă, taxe suplimentare, coduri), locațiile,
vehiculele, șoferii, clienții, cursele, componentele TPO, etapele, facturile, șabloanele de raport,
teritoriile, comenzile, produsele de depozit, **utilizatorii**, **garajul**, și evenimentele de
securitate (autentificare, autentificare eșuată, deconectare, încheierea sesiunilor).

## Ce NU se înregistrează, intenționat

Ecranul are un panou care spune asta explicit, ca un gol să se citească drept decizie, nu defect:

| Nu se înregistrează | De ce |
|---------------------|-------|
| Pozițiile GPS | Un rând per ping ar îngropa restul jurnalului |
| Mesajele de chat | Mesajul însuși e înregistrarea |
| Notificările | Efect, nu decizie |
| Sugestiile automate | Generate de mașină, nu de un om |
| **Avizele** | Au deja un jurnal propriu, mai detaliat, pe fiecare câmp OCR |
| Documentele de cursă | Au propriul traseu |
| Rutele recalculate | Se recalculează des și automat |

## Reguli care fac jurnalul de încredere

**Se salvează doar ce s-a schimbat efectiv.** Salvarea unui formular neatins nu produce nicio
înregistrare. Diferența se ia între datele reale, nu față de ce a trimis browserul — deci apar și
valorile calculate de sistem.

**La ștergere se păstrează rândul întreg.** E singurul moment în care nimic altceva nu mai are
datele. Jurnalul supraviețuiește înregistrării pe care o descrie.

**Numele autorului rămâne chiar dacă contul e șters.** Se salvează pe eveniment, nu se caută
ulterior.

**Valorile sensibile nu ajung niciodată acolo.** Parole, token-uri, coduri — filtrate automat.

**Jurnalul nu se șterge niciodată.** Nu are politică de retenție.

## Ce urmărim

- **Fiecare schimbare de tarif are un autor și un moment.**
- **Zero modificări pe curse deja facturate** — sau, dacă există, explicate.
- **Zero serii de autentificări eșuate** pe același cont.
- **Zero schimbări de rol neașteptate.**

## Când îl folosești

- „De când e tariful ăsta 2,8?" → filtrezi pe Tarif contractual, cauți clientul.
- „Cine a mutat garajul?" → filtrezi pe Garaj.
- „De ce cursa asta arată altfel decât pe factură?" → istoricul cursei.
- „Cine a dat drepturi de administrator?" → filtrezi pe Utilizator, acțiune Modificat.
