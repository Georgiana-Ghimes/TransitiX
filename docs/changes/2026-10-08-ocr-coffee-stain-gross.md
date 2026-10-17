# #74 — Greutate brută goală sub pată de cafea

## Problemă

Pe `IMG-20261003-WA0047.jpg` (TPO-0033539) o pată translucidă acoperă zona „Greutate brută”. Valoarea `6,994.45` e citibilă pe hârtie; neta `6,640.15` se extrage; brută rămânea goală → mesaj taxă zonă.

## Cauze tipice OCR sub pată

- cifră lipsă: `699.45` în loc de `6,994.45` (sub netă → respinsă de #73 fără recuperare)
- zecimal lipit: `6.99445` → parse ~7 kg (sub min camion)
- grupuri spațiate: `6 994 45` → `699445` (peste max)

## Fix

- `normalizeWeightRaw` — spații → mii/cenți; `D.DDDDD` → formă RO
- `repairGrossMissingDigit` — ×10 / ×1000 când rezultatul e ≥ netă cu delta de ambalaj plauzibil (încredere 0.55 → HITL)
- `gross_missing_near_net` — dacă neta e prezentă, eticheta de brută există pe text, dar câmpul e gol → verificare obligatorie

## Fișiere

- `server/src/lib/ocr/fields.js`
- `server/src/lib/ocr/validateAviz.js`
- teste în `extract.test.js` / `validateAviz.test.js`
