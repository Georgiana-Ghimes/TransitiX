# #78 — Plăcuță B-23-NKL în loc de B-29-NKL

## Problemă

`IMG-20261002-WA0045.jpg` (TPO-0033523): foto de noapte. Pe hârtie `B 29 NKL / B 81 NKL`; app `B-23-NKL / B-81-NKL` (9→3 pe tractor).

## Fix

Înainte de scrierea avizului / `ensureVehicleForPlate`: dacă tractorul OCR nu e în Autoturisme, dar există exact un vehicul activ cu același județ + serie de litere și **o singură cifră** diferită, se folosește plăcuța din flotă (conf. 0.55 → verificare). Nu se mai deschide o fantomă `B-23-NKL`.

## Fișiere

- `server/src/lib/fleet/plateRegistry.js`
- `server/src/routes/documents.js`
