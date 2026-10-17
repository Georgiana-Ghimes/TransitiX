# P3: SSE live board + ePOD

## SSE

`GET /api/telematics/stream` — `text/event-stream`, office JWT via header or
`?access_token=` (EventSource cannot set Authorization).

Hub: `server/src/lib/telematics/liveHub.js` (in-process, one API node).

| event | when |
| --- | --- |
| `hello` / `ping` | connect / keepalive 25s |
| `position` | after ingest + evaluate |
| `exception` / `exception_ack` / `exception_resolved` | exception lifecycle |
| `eta` | cascade applied |
| `pod` | ePOD saved |

UI: `useTelematicsStream` on GPS map + exceptions panel. Poll remains as fallback
(slower when SSE is connected). Map markers tint by open exception severity.
Dispatch shows a plan-vs-realized bar per route.

## ePOD

Table `delivery_proofs` — one row per `route_stop` (`UNIQUE company_id, route_stop_id`).

| outcome | stop status |
| --- | --- |
| `livrat` / `partial` | `finalizat` |
| `refuzat` | `esuat` |

`POST /api/routes/:id/stops/:stopId/pod` — driver or office. Signature as
`data:image/png;base64,…` written under company-prefixed `/uploads/`. Photos via
existing upload endpoint. Refusal requires a reason; delivery requires recipient + signature.

Driver app: **Gata** / **Nu s-a putut** on delivery stops open `DriverPodModal`
instead of a bare status flip.
