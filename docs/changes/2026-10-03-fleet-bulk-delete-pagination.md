# Autoturisme: paginare + ștergere în bulk

## API

- `GET /api/fleet?q=&limit=&offset=` → `{ items, total, missing_mma, limit, offset }`
  (doar active; page size 20/50/100/500)
- `POST /api/fleet/bulk-delete` `{ ids }` → `{ deleted, ids }` + audit `Vehicle` delete

## UI (`/fleet`)

Multiselect pe rând, „Selectează pagina”, **Șterge selectate** cu confirmare,
paginare ca la Avize (dropdown + Înapoi/Înainte). Bannerul MTMA folosește
`missing_mma` pe tot filtrul, nu doar pagina curentă.
