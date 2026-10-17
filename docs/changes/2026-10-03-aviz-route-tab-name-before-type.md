# Aviz route: tab OCR name+house above street type

## Problem
Client Baumit two-column PDF text put the delivery street as:
`Viilor\t52\t…` then `Șosea\tnr.` — name and house above the type word.
Parser kept only the locality (`Bucuresti`) or, earlier, the Client column street (`Aeroportului`).

## Fix
- `leftColumnFromInterleaved`: keep `name\thouse` left cells; ignore `5 RO` sector fragments; treat bare `nr.` as continuation after a type cell.
- `parseStreetParts`: `NAME HOUSE TYPE` via regex immediately before the type (last name token only — no site leftovers like `lohn`).
- House near the type/name window only (not the whole postcode tail).

## Verify
`npx vitest run server/src/lib/avizOcr.test.js` — 70 pass, including client-original tab fixture.
Re-extract / repair stored rows to refresh `ruta_transport`.
