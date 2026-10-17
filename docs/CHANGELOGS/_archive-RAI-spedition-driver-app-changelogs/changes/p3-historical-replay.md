# P3: historical replay

`GET /api/telematics/replay?date=YYYY-MM-DD` — routes with a vehicle that day.
`GET /api/telematics/replay/:routeId` — planned OSRM geometry (when routing is up) +
telematics breadcrumb for `route_date`, thinned for the map, plus KPIs.

Actual km is haversine along the GPS trail (realized path), not a second OSRM call.
Planned km comes from OSRM overview=full, falling back to `routes.planned_distance_km`.

UI: Tracking GPS → **Reluare** (blue plan / orange dashed actual / stop markers).
