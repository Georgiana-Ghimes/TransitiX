# Editează aviz: fără clipire / pierdere date la schimbarea câmpului

## Problemă

La completarea manuală a unui aviz (câmpuri goale), la fiecare mutare pe alt câmp pagina părea că se reîncarcă și valorile deja tastate dispăreau.

## Cauze

1. Câmpuri `type="number"` controlate de React — valori intermediare / blur respingeau inputul (aceeași clasă de bug ca la `numar_curse`).
2. Draft-ul trăia în `AvizeReports`; re-render (poll listă, taxă zonă, findings) putea reseeda sau lupta cu valorile din rândul salvat.
3. Preview + panoul taxă zonă se goleau pe fiecare resolvere sincronă → senzație de refresh.

## Remediere

- Toate câmpurile numerice din `AVIZ_FORM_FIELDS` sunt `text` + `inputMode`.
- `emptyForm` stringify-uiește valorile pentru inputuri controlate.
- Draft-ul e local în `AvizEditModal`; reseeding doar la deschidere / `formRevision` (Re-extrage).
- Debounce pe rezolvarea zonei; preview nu mai blank-uiește `src` la fiecare fetch.
