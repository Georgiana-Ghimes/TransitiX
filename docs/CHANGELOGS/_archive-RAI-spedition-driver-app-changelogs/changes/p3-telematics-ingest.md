# P3 start: telematics ingest

Foundation for live execution. Simulation remains as a demo path; real positions come from
the driver phone and from provider webhooks.

## Schema

- `companies.telematics_api_key_hash` — SHA-256 of `tx_…` key; plaintext shown once on rotate
- `telematics_positions` — full trail (vehicle, optional route/trip, coords, speed, heading,
  ignition, accuracy, recorded_at, source, payload)
- `route_exceptions` — empty bus for the next increment (delay, deviation, idle, speed)

## Write path

`ingestPosition` / `ingestPositions` in `server/src/lib/telematics/ingest.js`:

1. Normalize sample (lat/lon aliases, plate or vehicle_id, reject future clocks)
2. Resolve vehicle in the company
3. INSERT `telematics_positions`
4. Clear `gps_logs.is_current` for that vehicle and INSERT a new current row

`gps_logs` is not deleted — it stays the projection the map already reads.

## API

| method | path | auth |
| --- | --- | --- |
| POST | `/api/telematics/ingest` | `X-Telematics-Key` |
| POST | `/api/telematics/position` | JWT (driver / office) |
| GET | `/api/telematics/live` | office JWT |
| GET | `/api/telematics/trail/:vehicleId` | office JWT |
| POST | `/api/telematics/key` | admin JWT |

Simulate (`POST /integrations/gps-simulate`) now goes through the same ingest with
`source: 'simulate'`.

## Frontend

- `DriverLocationReporter` — watchPosition + 30s interval while DriverRoute has a vehicle
- `GPSMap` — polls `/telematics/live`, shows source, admin key rotate, simulate demoted

## Next

Exception engine on ingest, cascading ETA, SSE board, ePOD.
