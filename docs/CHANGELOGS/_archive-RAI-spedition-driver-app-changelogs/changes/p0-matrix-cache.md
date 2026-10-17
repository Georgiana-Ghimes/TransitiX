# Road-network matrix cache

Closes the last open P0 deliverable: *"Cache de matrice în Postgres, cheie pe perechea de
noduri snapped, cu TTL — altfel P2 recalculează inutil aceleași distanțe în fiecare zi."*

## What

`server/src/lib/geo/matrixCache.js` — `cachedMatrix(db, companyId, points, opts)`. Same shape
as `osrmTable`, plus a `cache` block reporting hits, misses and how many calls it made.

Two tables, both company-scoped for the same reason `geocode_cache` is: the set of point
pairs a tenant measures is its delivery network.

- `geo_snap_cache` — requested coordinate → snapped graph node.
- `route_matrix_cache` — snapped node pair → distance, duration, `expires_at`.

## Why the keys are snapped nodes

Keying on the requested coordinate would mean a re-geocode that nudges a pin by two metres
throws away every distance for that customer. Snapped nodes survive that.

Snapping normally costs a `nearest` call per point, which would be 200 round trips on a cold
cache. It does not here: OSRM's `table` response already reports the snapped location of
every point it was given, so the mapping is learned from calls we were making anyway.
`parseTableResponse` now surfaces those `sources`/`destinations` waypoints.

## Why `planFetch` is not one rectangle

The obvious plan — fetch every row and every column that contains a miss — collapses the
moment one new point appears. That point misses against everything, so every row and column
is dirty and the whole matrix is re-measured. The cache would save nothing in the one case
it exists for.

Instead the misses are split by how they arise:

| shape | rectangle |
| --- | --- |
| point with no known node | `unknown × all`, then `known × unknown` |
| pair that expired or was never stored | one rectangle over just those points |

Five new points among two hundred: 1 975 cells in two calls instead of 40 000 in one.

If the rectangles together cover more than 60% of the matrix (`SPLIT_THRESHOLD`), it falls
back to a single call — the same work for OSRM, one fewer round trip.

## Failure behaviour

Best-effort in both directions. A read failure falls back to measuring; a write failure
returns the matrix it just measured. `OSRM_URL` unset stays a 503, unchanged — a cold cache
has nothing to answer with, so it reaches OSRM and gets the same error as before.

## Wired into

- `POST /api/geo/matrix` — whole-matrix requests only. An explicit `sources`/`destinations`
  sub-matrix goes straight to OSRM, since the cache stores whole pairs.
- `recomputeRoute` in `server/src/routes/routes.js` — every dispatch-board reorder.
- P2's solver, once it exists. That is the caller this was built for.

## Not verified against a live graph

`OSRM_URL` is unset in this environment, so the 19 unit tests use a fake OSRM. The hit rate
and the sub-matrix shapes are covered; actual snapped-node stability across an OSRM restart
is not.

## Config

`OSRM_MATRIX_TTL_DAYS`, default 30.
