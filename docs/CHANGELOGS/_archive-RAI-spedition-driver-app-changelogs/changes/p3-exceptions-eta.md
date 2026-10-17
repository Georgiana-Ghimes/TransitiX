# P3: live exceptions + cascading ETA

After each successful telematics ingest, the server evaluates the vehicle against
its live route for today and may open `route_exceptions` rows.

## Detection (`exceptions.js`, pure)

| type | meaning |
| --- | --- |
| `intarziere` | next open stop past planned_arrival + 15′ grace, not at stop |
| `prea_devreme` | at stop before window_start − 30′ |
| `abatere_traseu` | nearest stop > 800 m |
| `stationare` / `oprire_neplanificata` | idle ≥ 20′ away from plan |
| `viteza` | speed > 90 km/h soft alert |

Open exceptions of the same type/vehicle/route/stop are not duplicated.

## Cascade

On a new `intarziere`, planned clocks from that stop onward are pushed by `by_min`,
route `planned_duration_min` stretches, and clients with an email on the affected
stops get a best-effort ETA mail (Resend or stub log).

## API

| method | path | auth |
| --- | --- | --- |
| GET | `/api/telematics/exceptions?open=1` | office |
| POST | `/api/telematics/exceptions/:id/ack` | office |
| POST | `/api/telematics/exceptions/:id/resolve` | office |

Office bell type `route_exception` links to `/dispatch`.

## UI

`RouteExceptionsPanel` on Dispecerat and Tracking GPS — poll 30s, ack / close.
