# P2, first increment: the solver foundation

Not the optimizer yet. This is the sidecar, the translation between our model and VROOM's,
and the schema the translation needs. No API endpoint and no UI — those come next.

## Schema

The solver matches an order against a vehicle on three numbers and a set of words. P1 put all
four on `orders`; this puts the other side of each comparison on `vehicles`.

| column | table | why |
| --- | --- | --- |
| `capacity_pallets` | vehicles | the third dimension, not derivable from kg and mc |
| `capabilities TEXT[]` | vehicles | the other side of `orders.requires` |
| `home_location_id` | vehicles | where the day starts and ends by default |
| `cost_per_km`, `cost_per_hour` | vehicles | enough of an objective to prefer one plan |
| `shift_start`, `shift_end` | drivers | bounds the route independently of the vehicle |
| `route_scenarios` | new | one run of the optimizer over one day |
| `scenario_id`, `planned_cost`, `actual_cost` | routes | which run produced this route |

`route_scenarios` has a partial unique index on `(company_id, route_date) WHERE is_committed`
— several scenarios per day, exactly one committed. `routes.scenario_id` is server-controlled
and stays out of the `Route` writable list, like `distance_source` and `route_stop_id`.

## `server/src/lib/planning/vroom.js`

HTTP client, same discipline as the OSRM one: unset `VROOM_URL` is a 503, never a fallback
plan. VROOM reports failure in the body with a non-zero `code` on an HTTP 200, so
`parseSolveResponse` checks the body, not the status.

## `server/src/lib/planning/solver.js`

Pure. The optimizer is three steps — collect the points, measure them, solve — and only the
middle one touches the network.

| ours | VROOM |
| --- | --- |
| order (`livrare`) | job with a `delivery` amount |
| order (`ridicare`) | job with a `pickup` amount |
| order (`schimb`) | job with both |
| `orders.requires` | job `skills` |
| `vehicles.capabilities` | vehicle `skills` |
| kg / mc / paleți | the three slots of an amount vector |
| driver shift | vehicle `time_window` |

Decisions worth remembering:

- **We supply the matrix.** VROOM can call OSRM itself; we never let it. The matrix comes
  from `cachedMatrix`, so a second run of the same day costs no road-network calls and only
  one component knows where the graph lives. The compose file sets `VROOM_ROUTER=""` so a
  request without a matrix fails loudly instead of measuring straight lines.
- **Integers everywhere.** Seconds, metres, bani, and hundredths of a cubic metre — rounding
  2.4 mc down to 2 would be a real constraint, a centilitre is not. `CAPACITY_DIMENSIONS` is
  the only place those scales are written down.
- **An unrecorded capacity is the day's total, not zero.** Zero would make a vehicle refuse
  every order, which is not what "nobody typed it in" means.
- **No cost model means no cost.** If no vehicle has `cost_per_km` or `cost_per_hour`, the
  problem carries no `costs` and VROOM optimizes duration; `kpis.cost` comes back null and
  `index.objective` says `timp`. Inventing a lei-per-km default would produce a plan that
  looks costed and is not.
- **An unmeasurable pair is impossible, not free.** Null cells become sentinels large enough
  never to be chosen and small enough that two hundred of them stay inside 32 bits.
  `strandedPoints` then names any location the network cannot reach at all, and
  `buildSolverInput` reports it in `dropped` rather than dragging it into a route.
- **Skill numbering is sorted.** The same fleet and the same orders must build the same
  problem, or comparing two scenarios compares noise.

## Caught in review

`pointOf` used `Number(entity?.latitude)`, and `Number(null)` is `0`, which is finite. An
order with no pin was placed in the Gulf of Guinea and then reported as unreachable instead
of as ungeocoded. Fifth time this trap has bitten in this codebase.

## Not verified against a live solver

`VROOM_URL` is unset in this environment. 44 unit tests cover the translation both ways
against hand-written VROOM documents; nothing has yet been round-tripped through the real
container.

## Next

1. `POST /api/planning/solve` — assemble orders and fleet, run the three steps, store a
   `route_scenarios` row.
2. The Reg. 561/2006 post-processor: the 45-minute break after 4h30 driving and the daily
   rest inserted as real `route_stops`, then windows re-checked. This is the part that goes
   past Roadnet rather than level with it.
3. Scenario comparison and promotion into real routes.
4. Replace the stub in `src/pages/PlanningAI.jsx`.
