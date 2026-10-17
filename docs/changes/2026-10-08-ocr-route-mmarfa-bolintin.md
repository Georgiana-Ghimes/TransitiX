# #79 — Rută MIMARFA / Bolintin-Dina

## Problemă

`IMG-20261002-WA0045.jpg` (TPO-0033523): foto noapte. Rută OCR `MIMARFA / … Bolintin-Dina` (și `Industriului`); pe hârtie `MMARFA` + `Bolintin-Deal` + `Industriei`.

## Fix

În `normalizeOcrText`:

- `MIMARFA` / `MIIMARFA` / `MMMARFA` → `MMARFA` (nu `MBMARFA`)
- `Bolintin-Dina` → `Bolintin-Deal`
- `Industriului` → `Industriei`

Notă: de confirmat cu Ștefan dacă denumirea oficială a depozitului e MMARFA (pe avizul de test apare așa).
