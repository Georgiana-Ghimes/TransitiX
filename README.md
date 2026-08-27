# Transitix

SaaS TMS (Transport Management System) for Romanian road freight: trips/CMR, fleet, drivers, warehouse, finance, and a driver app.

**Manual de utilizare** (în română, pentru cine folosește aplicația): [`docs/manual/`](docs/manual/README.md)
— ce face fiecare ecran, rezultatele urmărite și problemele frecvente. Acest README e pentru
cine o rulează și o dezvoltă.

No teammate secrets are required to log in locally. Invented Docker/JWT values are enough; optional Google Vision / Resend keys stay empty and the app uses stubs.

## Stack

- **Frontend:** React + Vite + Tailwind (`src/`)
- **Backend:** Node.js + Express (`server/`)
- **Database:** PostgreSQL 13+ (16 in Compose)

Requires **Node >= 20.11** and **npm >= 10** — pinned in `engines` in both `package.json` files.

## Product map

| Area | Path | Notes |
|------|------|--------|
| Dashboard | `/` | KPIs, recent trips, Recharts |
| Dispecerat | `/dispatch` | Plan orders onto routes: sequence, ETAs, capacity warnings |
| Încărcare / Plan 2D | `/loading` `/load-planner` | Load building and a 2D plan of the trailer |
| Curse | `/trips` | CMR trips, assign driver/vehicle, auto `distance_km` |
| Flotă / Șoferi / Clienți | `/vehicles` `/drivers` `/clients` | Cards + deactivate/reactivate |
| Locații | `/locations` | Geocoding review: map, confidence tiers, drag-to-fix pins |
| Teritorii | `/territories` | Zone definitions behind zone charges |
| Tracking GPS | `/gps` | Live positions from `telematics_positions`; the demo feed is one of several sources |
| Planning AI | `/planning` | VROOM when configured, stub suggestions otherwise |
| Financiar | `/finance` | Invoices built from `trip_charges`; click the number for the components. e-Factura is a **simulation** |
| Depozit | `/warehouse` | Stock products |
| Documente | `/documents` | Expiry alerts (ITP, RCA, permis, …) |
| Avize / Rapoarte | `/avize` | Upload avize → review table → Anexa Factura XLSX. Files under `/uploads` need a login token |
| Rapoarte | `/reports` | Report builder over a source registry: presets, preview, export history with snapshots |
| Verificări date | `/checks` | Rules that catch a trip about to be invoiced wrong |
| Config. comercială | `/commercial` | Contracts, tariffs, zone charges, surcharges, observation codes, depot |
| Utilizatori | `/users` | **Admin.** Invitations, roles, deactivation, driver-profile links |
| Jurnal modificări | `/audit` | **Admin.** Who changed what, with the fields that moved |
| Setări | `/settings` | Company profile + document-alert thresholds |
| App Șofer | `/driver-app` | Assigned trips, CMR (photo or signed digitally), status flow, works offline |
| Portal client | `/confirm/:token` | Delivery confirmation link |

### Known stubs / demos (not production integrations)

- **OCR:** Google Vision when `GOOGLE_VISION_API_KEY` is set; otherwise trip-prefill stub (CMR) / empty aviz fields to edit by hand. PDFs with a text layer parse without Vision.
- **Email:** Resend when `RESEND_API_KEY` + `EMAIL_FROM` are set; otherwise console log (reset-password still returns a local link)
- **Planning AI:** VROOM when `VROOM_URL` is set; labelled stub suggestions otherwise
- **ANAF e-Factura / e-Transport:** simulated. e-Transport codes are prefixed `STUB-` on the code
  itself so a placeholder can never be read as a real UIT at the roadside
- **Routing:** real (OSRM) when `OSRM_URL` is set; otherwise `/api/geo/*` returns 503 rather than a made-up distance
- **Geocoding:** real (Photon) when `PHOTON_URL` is set. Pins below 0.8 confidence are saved but left unverified for a human to confirm; below 0.45 nothing is saved at all

## Local run (no teammate `.env`)

Preferred: **Postgres in Docker**, Vite + Express on the host (hot reload).

### 1. Database

Either a container:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
```

Host port is **5434** (avoids clashes with other local Postgres on 5432/5433).

Or a Postgres you already run natively — nothing here needs the container. Point `DATABASE_URL`
at it (`…@localhost:5432/transitix` for a default install) and skip to the next step.

### 2. Backend env

```bash
copy server\.env.example server\.env   # Windows
# cp server/.env.example server/.env  # macOS/Linux
```

Example (`server/.env.example`):

```
DATABASE_URL=postgresql://postgres:password@localhost:5434/transitix
JWT_SECRET=local-dev-jwt-secret-change-me
CLIENT_ORIGIN=http://localhost:5173
PORT=3001
```

Leave `GOOGLE_VISION_API_KEY` and `RESEND_API_KEY` empty unless you have keys.

### 3. Install, migrate, seed

```bash
npm install
npm install --prefix server
npm run db:migrate
npm run db:seed
# optional extra fleet/trips:
npm run seed:demo --prefix server
npm run db:seed:fleet
```

### 4. Routing engine (optional, needed for `/api/geo`)

Builds the OSRM graph once (~250 MB download, a few minutes of CPU), then runs it as a sidecar:

```bash
npm run osrm:prepare
```

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.osrm.yml up -d db osrm
```

Then set `OSRM_URL=http://localhost:5000` in `server/.env`. Check with `GET /api/geo/health`.

No Docker? For development only you can point `OSRM_URL` at the public demo server
`https://router.project-osrm.org` — it is rate-limited, has no SLA, and must never see
real customer addresses.

### 5. Geocoder (optional, needed to put locations on the map)

Photon turns addresses into coordinates. Self-host it (recommended — customer addresses stay
in-house), or for development only point at the public instance:

```
PHOTON_URL=https://photon.komoot.io
```

That instance is rate-limited, has no SLA, and must never see real customer addresses.

```bash
npm run db:backfill:locations -- --apply
```

```bash
npm run db:geocode:locations -- --apply
```

The geocoder scores every result. At or above 0.8 the pin is saved outright; between 0.45 and
0.8 it is saved but flagged for a human to confirm on the map; below that nothing is written —
a location with no pin is honest, a location with a wrong pin is not.

Whatever the batch run could not settle shows up at **`/locations`**: the queue opens on the
worst matches, each pin is draggable, and confirming one is the only thing that sets
`geocode_verified`. That screen works without `PHOTON_URL` too — you just place pins by hand
instead of correcting the geocoder's guesses.

The dispatch board at **`/dispatch`** plans orders onto routes. Every action has a button
(assign from a dropdown, reorder with arrows, detach with ×); drag-and-drop is layered on top
for desktop only, so the board stays fully usable on a phone. Without `OSRM_URL` you can still
build and sequence routes — distances, ETAs and the map trace stay empty, and the board says so.

Once both ends of a trip resolve to known coordinates, `trips.distance_km` fills itself in on
save. `trips.distance_source` records who owns the value: a number a dispatcher typed is
`manual` and is never overwritten — clear the field to hand it back, or
`POST /api/geo/trips/:id/distance` with `{"force":true}`. Saving a CMR never depends on OSRM
being up; when it is unreachable the trip saves with no distance.

### 6. Start API + UI

```bash
npm run dev --prefix server   # http://127.0.0.1:3001
npm run dev                   # http://127.0.0.1:5173  (proxies /api and /uploads)
```

Use **http://127.0.0.1:5173/** on Windows (plain `localhost` can hit IPv6 and fail the proxy).

Health: `GET /api/health`.

### Seed accounts

| Role | Email | Password |
|------|--------|----------|
| Admin (office) | `admin@transitix.ro` | `admin123` |
| Șofer (driver app) | `sofer@transitix.ro` | `sofer123` |

### App Șofer smoke

1. Log in as `sofer@transitix.ro`
2. You land on **App Șofer** with assigned trips
3. From office: Curse → assign that driver → status `alocata` appears in the app

### Alternate: full Compose / VM

Copy `docker.env.example` → `.env` at the repo root (set `JWT_SECRET`, `POSTGRES_PASSWORD`, `CLIENT_ORIGIN`, optional Resend). Then:

```bash
docker compose up --build
```

Serves the packaged app at `http://localhost:8082` (API + web + DB, seed on start). Better for a VM demo than daily coding. Production still needs a real `JWT_SECRET`, published HTTPS origin, and Resend keys if you want outbound mail.

## Tests

```bash
npm test          # unit suite — runs on a clean checkout with nothing started
npm run test:api  # route tests against a real Postgres
```

The route tests mount the Express app with supertest and talk to a real database, so they catch
the schema and type mistakes a mocked test cannot. They need `TEST_DATABASE_URL` in `server/.env`
pointing at a database **whose name ends in `_test`** — the setup refuses anything else and
creates it if missing:

```
TEST_DATABASE_URL=postgresql://postgres:password@localhost:5434/transitix_test
```

## Migrations

`npm run db:migrate` applies the baseline schema once, then every numbered file in
`server/src/migrations/` that has not run yet.

| Command | Description |
|---------|-------------|
| `npm run db:migrate` | Apply everything pending |
| `npm run db:migrate:status` | What has run and what has not |
| `npm run db:migrate:down` | Undo the last migration, if it has a `.down.sql` |

New schema changes go in `server/src/migrations/NNNN_name.sql`, with `NNNN_name.down.sql` beside
it wherever the change can be undone. Do not add them to the baseline in `migrate.js`: a statement
there runs on every deploy forever, which is fine for `IF NOT EXISTS` and quietly wrong for
anything else.

## Logs

The API writes structured lines — human-readable by default, JSON under `NODE_ENV=production`,
overridable with `LOG_FORMAT`. Every request gets an id, returned as `X-Request-Id` and stamped on
every line the request produces, so a report of "an error around 14:32" maps to the lines that
caused it. `LOG_LEVEL` filters (`debug`/`info`/`warn`/`error`). Credentials never reach the log:
field names matching password, token, secret, authorization, cookie or key are redacted.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Frontend Vite (`127.0.0.1:5173`) |
| `npm run dev:server` | Backend Express (`:3001`) |
| `npm run db:migrate` | Schema + indexes |
| `npm run osrm:prepare` | Download OSM extract + build the OSRM routing graph |
| `npm run db:backfill:locations` | Report address quality; `-- --apply` writes `locations` rows |
| `npm run db:geocode:locations` | Geocode locations without coordinates; `-- --apply` saves pins |
| `npm run db:seed` | Admin + driver users |
| `npm run db:seed:fleet` | Extra dummy vehicles/drivers/clients |
| `npm test` | Vitest unit tests |
| `npm run test:api` | Route tests against a real Postgres (`TEST_DATABASE_URL`) |
| `npm run test:all` | Both suites |
| `npm run db:migrate:status` | Which migrations have run |
| `npm run db:migrate:down` | Undo the last migration |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc` over the JS with checkJs |
| `npm run build` | Production frontend build |
| `npm run version:bump` | `major`/`minor`/`patch` or an explicit version, in both package.json files |

## Docs & versioning

Root and `server/package.json` versions stay aligned — the sidebar reads the root one, `/api/health`
reports the server one, and a mismatch turns "which version is this?" into a question with two
answers. The post-commit hook bumps from the commit message (`feat:` minor, `!`/breaking major,
everything else patch, `[skip version]` to opt out); `npm run version:bump` does the same by hand.

Local notes (`docs/`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`) are gitignored.
