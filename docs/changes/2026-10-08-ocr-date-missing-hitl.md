# #81 — Data efectuare cursă goală, fără etichetă de verificare

## Problemă

`IMG-20261005-WA0051.jpg` (PSL-0062341): colțul din dreapta sus îndoit ascunde data. Câmpul rămâne gol (corect), dar Editează aviz nu arăta nicio etichetă care să ceară completarea manuală. Taxa zonă putea afișa 0 lei fără context.

## Cauză

1. `date_missing` exista deja (HITL pe listă), dar **Editează aviz** nu afișa `validation_findings` sub câmpuri.
2. Pentru câmp gol cu `confidence: 0`, validarea mai emitea și „Scor OCR 0%” — zgomot, nu „completează manual”.
3. Heuristica din `decorateAviz` nu includea `data_efectuare_cursa` la semnalul de review.

## Fix

- Mesaj `date_missing`: cere explicit completarea manuală (colț îndoit / OCR)
- Fără finding de confidență pe valori goale (rămân regulile dedicate)
- Benzi amber sub câmpul Dată + bandă „Verificare necesară” sub formular în Editează
- `data_efectuare_cursa` în heuristicReview pe listă
