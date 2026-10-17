# 15. Financiar și facturare

## Ce face

Emite facturile și urmărește încasările.

## Ce vezi

| Indicator | Ce arată |
|-----------|----------|
| **Facturi emise** | Numărul din luna curentă |
| **Încasat** | RON, luna curentă |
| **Facturi restante** | Neplătite, trecute de scadență |

Plus lista de facturi, cu căutare.

## Cum se construiește o factură

Aici e o regulă care merită înțeleasă, fiindcă explică de ce sistemul uneori refuză:

**Factura se construiește din componentele TPO calculate de motor. Din nimic altceva.**

Exista înainte o a doua cale: adunarea valorii scrise pe aviz, o coloană în care un operator
scrie cu mâna și pe care OCR-ul o poate completa. Cele două puteau să nu fie de acord, nimic nu le
compara, deci o factură putea pleca pe o cifră pe care nimic n-o recalculase. Acea cale a
dispărut.

Consecințe practice:

- **O cursă fără TPO calculat e refuzată și numită.** Nu se substituie o cifră aproximativă.
- **Dacă avizul spune 1 și motorul spune 975, câștigă motorul** — și diferența se semnalează.
- Când ciorna acoperă mai multe curse, factura **nu se leagă de niciuna** în antet. Legarea de
  prima nimerită ar arhiva documentul la cursa greșită.

## Componentele facturii

**Click pe numărul facturii** deschide liniile din care e făcută: referință, componentă,
cantitate, preț unitar, valoare.

De ce contează: un client contestă „de ce 120 la macara", nu „de ce 975". Un subtotal singur nu-i
dă la ce se uita.

O factură creată manual, nu din TPO-uri, o spune explicit — nu are linii.

## TVA

Cota vine din **regimul fiscal al firmei**, setat în [21. Setări](21-setari.md), nu dintr-un 19
fix. O firmă neplătitoare de TVA nu trebuie să aibă TVA adăugat.

## e-Factura

**Simulare.** Se generează XML local (format UBL). **Nu se trimite nimic la SPV.** Ecranul o spune:
„Export local · SPV off".

## Ce urmărim

- **Zero facturi emise pe cifre neverificate.** Sistemul o impune, dar obiectivul rămâne.
- **Timp scurt de la livrare la factură.** Fiecare zi de întârziere e o zi de finanțare gratuită
  oferită clientului.
- **Facturi restante în scădere**, ca număr și ca vechime.
- **Zero contestații** pe compunerea facturii — componentele vizibile sunt ce le previne.
- **Marjă pe client**, urmărită lună de lună.

## Ce poate merge prost

| Simptom | Cauză |
|---------|-------|
| „Cursa nu are TPO calculat" | Lipsește tariful, sau TPO-ul n-a fost recalculat. Vezi [13. Verificări](13-verificari.md) |
| Avertisment „total diferit de linii" | Totalul stocat și componentele nu se potrivesc. Se facturează componentele |
| Nu apare TVA | Firma e setată ca neplătitoare, în Setări |
| Factura n-are linii | A fost creată manual, nu din TPO-uri |
