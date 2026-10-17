# #78 reopen — B-23-NKL rămâne deși B-29-NKL e în Autoturisme

## Cauză

`extractBatchDocuments` apela `resolveOcrPlateAgainstFleet(query, …)`. `plateRegistry` face `db.query(…)`, iar `query` din `db.js` e o funcție goală → TypeError → catch → fără repair pe aviz.

## Remediere

- Apel cu `pool` (are `.query`)
- `runDbQuery` acceptă și `query(text, params)`, ca un al doilea bug de tipul ăsta să nu mai fie tăcut
