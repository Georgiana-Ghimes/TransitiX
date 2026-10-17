# 13. Verificări date

## Ce face

Rulează un set de reguli peste date și îți arată ce e greșit **înainte** să plece la client sau să
ajungă pe o factură.

Este ecranul de citit înainte de fiecare decont.

## Regulile

| Constatare | Consecința dacă o ignori |
|------------|--------------------------|
| **Cursă fără tarif valabil** | TPO-ul se calculează fără linia de transport, deci cursa se facturează sub valoare |
| **Total TPO diferit de suma liniilor** | Documentul nu-și mai explică propria cifră — una dintre cele două a fost editată separat |
| **TPO calculat fără kilometri** | Lipsește componenta de kilometri din valoarea cursei |
| **Cursă modificată după calculul TPO** | Valoarea stocată poate să nu mai corespundă cursei, dar arată ca și cum ar fi la zi |
| **CMR digital nesemnat la livrare** | Cursa e livrată, dar predarea mărfii nu are nicio semnătură în spate |
| **Aviz confirmat fără greutate brută** | Raportul construit din el nu poate fi confruntat cu bonul de cântar |
| **Aviz confirmat nelegat de cursă** | Documentul nu aparține niciunei curse, deci nu va ajunge pe nicio factură |
| **Același TPO pe mai multe documente** | Anexa va conține același număr de mai multe ori și nu se mai poate reconcilia |

Fiecare constatare spune trei lucruri: **ce e**, **ce se întâmplă dacă o lași așa**, și **cum se
repară**. Click pe ea te duce direct la înregistrarea vinovată.

## Cum lucrezi

1. Alegi perioada.
2. Parcurgi constatările grupate pe regulă, cele grave primele.
3. Repari — linkul te duce unde trebuie.
4. Ce e intenționat, **ascunzi**.

### Despre „Ascunde"

Ascunderea nu e ștergere. Constatarea **reapare dacă datele se schimbă din nou**, fiindcă cheia ei
se recalculează din date. Nu poți face o problemă să dispară definitiv ascunzând-o — poți doar
spune „știu, e în regulă așa".

## O garanție care merită înțeleasă

Regula „cursă fără tarif valabil" folosește **exact aceeași funcție** de căutare a tarifului pe
care o folosește calculul TPO.

Nu e o coincidență de implementare: înseamnă că alerta și factura nu pot fi în dezacord. Nu există
situație în care verificările spun „e bine" și motorul calculează altceva.

## Ce urmărim

- **Zero constatări grave** înainte de fiecare decont.
- **Timp scurt între apariția unei constatări și rezolvarea ei.**
- **Număr de constatări în scădere lună de lună.** Dacă aceeași regulă se aprinde mereu, problema
  nu e la date — e la procesul care le produce.
- **Zero reclamații de la client** pe cifre. Ecranul acesta e ce le previne.
