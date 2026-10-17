# P1 — import comenzi, CMR din rută, foaie de parcurs, ruta la șofer

Închide ultimele patru puncte rămase din P1.

## Import comenzi (XLSX / CSV)

- `server/src/lib/orders/orderImport.js` — parsing, mapare de coloane, potrivire și validare,
  tot pur (33 de teste). Parser CSV propriu cu detecție de delimitator (`;`, `,`, tab, `|`),
  ghilimele duble, BOM și CRLF; XLSX prin `exceljs`.
- Numere: separatorul din dreapta câștigă când apar amândouă; un punct singur cu exact trei
  zecimale e mie (`1.500` = 1500). Date zi-întâi, plus seriale Excel și celule `Date`.
- Potrivirea locației: nume exact (refuzat dacă e ambiguu), apoi `address_key` — aceeași cheie
  de deduplicare din pipeline-ul geo, deci o adresă scrisă altfel ajunge pe același pin.
- `POST /api/orders/import` (multipart, memory storage, 5 MB, 20 cereri/minut/companie).
  `dry_run` implicit. Scrierea e într-o singură tranzacție; `23505` → 409.
- UI: `src/components/OrderImportModal.jsx` — previzualizare linie cu linie, carduri sub `md`
  și tabel de la `md` în sus, plus șablon CSV descărcabil.

## CMR din rută

- `server/src/lib/routing/routeCmr.js` — pur (19 teste). Sensul documentului urmează tipul
  opririi; numerotare `CMR-YYYY-MMDD-NN` cu offset în cadrul lotului.
- `fullAddress()` recompune stradă + oraș + județ; `loadStops` pune rezultatul pe fiecare
  oprire ca `address_full`, folosit și de CMR, și de aplicația de șofer.
- Migrare: `trips.route_stop_id` + index unic parțial. Aici stă idempotența.
- `POST /api/routes/:id/trips`.

## Foaie de parcurs PDF

- `src/lib/routeSheet.js` (11 teste) — modelul foii; `src/lib/routeSheetHtml.js` (10 teste) —
  HTML-ul paginii, cu escaping; `src/lib/routeSheetPdf.js` — rasterizare `html2canvas` +
  `jspdf`, încărcat dinamic (chunk de ~600 kB, nu intră în bundle-ul principal).
- Rasterizat, nu vectorial: fonturile standard PDF nu pot codifica `ș`, `ț`, `ă`.
- 12 opriri pe pagină, antet pe fiecare, semnături pe ultima.

## Ruta în aplicația de șofer

- `GET /api/routes/mine?date=` și `PUT /api/routes/:id/stops/:stopId/status`, definite
  **înainte** de `router.use(officeRequired)`; ownership verificat pe profilul de șofer
  (`user_id`, apoi email), cu birou permis pentru previzualizare.
- Timestamp-urile de sosire/plecare le pune serverul. Starea rutei și a comenzii se derivă
  din stările opririlor.
- `src/lib/driverRoute.js` (16 teste) + `src/components/driver/DriverRoute.jsx`, tab nou
  în `DriverApp`.

Verificat pe date reale: import CSV și XLSX, două CMR-uri emise idempotent, ciclu complet de
bifare a unei opriri de către șofer. 519 teste, lint curat, build curat.
