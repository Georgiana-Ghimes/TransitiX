# P4: territories

Capacitated geographic clustering over geocoded `locations`, weighted by open-order
volume / kg / count. Convex-hull polygons (padded ~2 km), no Turf dependency.

## API

| method | path | notes |
| --- | --- | --- |
| GET | `/api/territories` | active territories + location_count |
| GET | `/api/territories/balance` | balance table vs mean |
| POST | `/api/territories/generate` | `{ k, apply }` — preview or replace+assign |
| PATCH | `/api/territories/:id` | name / color / polygon |
| POST | `/api/territories/:id/assign` | `{ location_ids }` |
| POST | `/api/territories/clear-assignments` | |

## UI

`/territories` — generate, balance table, map polygons + location dots colored by territory.
