# #76 — Tip marfă / Cantitate goale pe foto de noapte

## Problemă

`IMG-20261002-WA0044.jpg` (PSL-0062309): lumină plafonieră galbenă. Pe hârtie `210.00 sac` + `140.00 sac` (= 350), tip saci. Greutăți și nr. document OK; tip + cantitate goale, fără etichetă de verificare.

## Cauze

1. OCR de tabel/noapte pune cifra și `sac` pe linii consecutive — matching-ul era doar pe aceeași linie (#63 a interzis `\s` cu newline).
2. Fără unități, rămânea doar `pce` / nimic → tip/cantitate goale.
3. `tip_marfa` / `cantitate_marfa` nu sunt critical → câmp gol fără finding HITL.

## Fix

- Perechi cross-line `210.00\nsac` / `| 210.00 |\n| sac |` (fără a reintroduce lipirea `m3\nPalet`)
- Tip: saci/găleți din inventarul de linii bat coloana `N pal`
- Fallback: net ÷ bag kg (25/35/40) pe foi de tip tencuială → 350 saci @ 0.55
- Normalize: `s ac` / `sa c` → `sac`
- Validare `goods_missing` (error) când tabelul există dar ambele câmpuri sunt goale
