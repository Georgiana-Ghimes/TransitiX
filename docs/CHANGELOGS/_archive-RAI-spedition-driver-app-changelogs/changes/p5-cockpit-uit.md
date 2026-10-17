# P5 — Cockpit KPIs + e-Transport UIT stub

## What

- Vehicle / company cost stack: fuel price, wage, toll, depreciation, maintenance (plus existing cost_per_km / hour and fuel_consumption).
- Pure libs: `server/src/lib/analytics/costModel.js`, `kpis.js` (punctuality, empty km, fill, plan vs actual, `buildCockpit`).
- `GET /api/analytics/cockpit?from=&to=` — office Dashboard row.
- `POST /api/routes/:id/launch` — status → `lansata`, then UIT via `etransport.js`.
- `ETRANSPORT_MODE=stub|off` — stub returns stable `RO` + hash; no fake ANAF credentials.
- UI: Dashboard cockpit cards; Dispatch launch (rocket) + UIT badge; VehicleForm cost detail fields.

## Out of scope (later)

- Real ANAF e-Transport SPV
- e-Factura UBL / SPV
- Tachograph `.ddd` import

## Notes

- Cost total stays null when no rates resolve — same honesty rule as the VROOM cost objective.
- `trips.uit_code` remains CMR-level; route-level UIT is on `routes.uit_*`.
