# P2: solve + promote scenarios

Second increment of the optimizer. The foundation (schema, VROOM client, solver translation)
can now run for a calendar day and turn one answer into real routes.

## API (`/api/planning`)

| method | path | what |
| --- | --- | --- |
| GET | `/health` | OSRM + VROOM ping |
| POST | `/solve` | measure → solve → store `route_scenarios` |
| GET | `/scenarios?date=` | list (omit `solution` unless `include=solution`) |
| GET | `/scenarios/:id` | one scenario with solution |
| POST | `/scenarios/:id/promote` | replace draft/planificata routes for that day |
| DELETE | `/scenarios/:id` | drop an uncommitted scenario |

Office auth. Solve is rate-limited to 10/min per company.

## Solve

`runSolve` loads open orders (`nou` / `planificat`) for the date, active vehicles, available
drivers, and the company depot (or `depot_location_id`). Preferred vehicle↔driver pairs come
from routes already drafted that day; the rest are paired in list order.

Flow: draft scenario row → `collectPoints` → `cachedMatrix` → `buildSolverInput` → `vroomSolve`
→ `parseSolution` → store `kpis` + `solution`. Failures after the draft leave `status = esuat`
with `error_message`. Missing OSRM/VROOM is a 503 and writes nothing.

The VROOM problem always carries our matrix (`VROOM_ROUTER` empty in compose). Time limit
goes in `options.t`.

## Promote

Replaces only `draft` / `planificata` routes. Any `lansata` / `in_executie` / `finalizata`
route for that day returns 409. Orders on replaced routes go back to `nou`, then assigned
ones become `planificat`. Exactly one scenario per day may be `is_committed`.

Arrival clocks in the solution are seconds-from-midnight; `plannedInstant` turns them into
timestamps in the server's local timezone — same rule the dispatch board already uses for
`starts_at`.

## Frontend client

`api.planning.{ health, solve, scenarios, scenario, promote, deleteScenario }`.

## Not done yet

- Reg. 561/2006 post-processor (breaks / daily rest as real stops)
- Scenario comparison UI and the Planning AI page replacement
- Vehicle form fields for the new capacity / capabilities columns (writable already)
