# OCR #68: carnet cu indici săriți / renumerotați

Ghidul 1–14 mapează slot→câmp. Dacă șoferul sare „Valoare TPO” (plăcuță pe 3, rută pe 4…), valorile alunecau: Valoare←plăcuță, Rută←tip, Greutate←PSL.

- `classifyCarnetLine` + `assignNumberedCarnet`: conținutul decide câmpul; indexul ghid e doar preferință.
- Ghidul 1–14 corect rămâne neschimbat; câmpurile opționale de bani nu fură cantitatea.
