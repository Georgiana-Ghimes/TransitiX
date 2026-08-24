# Transitix

SaaS TMS (Transport Management System) for Romanian road freight: trips/CMR, fleet, drivers, warehouse, finance, and a driver app.

No teammate secrets are required to log in locally. Invented Docker/JWT values are enough; optional Google Vision / Resend keys stay empty and the app uses stubs.

## Stack

- **Frontend:** React + Vite + Tailwind (`src/`)
- **Backend:** Node.js + Express (`server/`)
- **Database:** PostgreSQL (Docker for local)

## Product map

| Area | Path | Notes |
|------|------|--------|
| Dashboard | `/` | KPIs, recent trips, Recharts |
| Curse | `/trips` | CMR trips, assign driver/vehicle |
| Flotă / Șoferi / Clienți | `/vehicles` `/drivers` `/clients` | Cards + deactivate/reactivate |
| Tracking GPS | `/gps` | Demo map (not live GPS) |
| Planning AI | `/planning` | Stub suggestions |
| Financiar | `/finance` | Invoices; e-Factura is a **simulation** |
| Depozit | `/warehouse` | Stock products |
| Documente | `/documents` | Expiry alerts (ITP, RCA, permis, …) |
| Avize / Rapoarte | `/avize` | Upload avize → review table → Anexa Factura XLSX. Files under `/uploads` need a login token. |
| Setări | `/settings` | Company profile + document-alert thresholds |
| App Șofer | `/driver-app` | Assigned trips, CMR photo, status flow |
| Portal client | `/confirm/:token` | Delivery confirmation link |

### Known stubs / demos (not production integrations)

- **OCR:** Google Vision when `GOOGLE_VISION_API_KEY` is set; otherwise trip-prefill stub (CMR) / empty aviz fields to edit by hand. PDFs with a text layer parse without Vision.
- **Email:** Resend when `RESEND_API_KEY` + `EMAIL_FROM` are set; otherwise console log (reset-password still returns a local link)
- **Planning AI / GPS / ANAF e-Factura:** labeled demos

## Local run (no teammate `.env`)

Preferred: **Postgres in Docker**, Vite + Express on the host (hot reload).

### 1. Database

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
```

Host port is **5434** (avoids clashes with other local Postgres on 5432/5433).

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

### 4. Start API + UI

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

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Frontend Vite (`127.0.0.1:5173`) |
| `npm run dev:server` | Backend Express (`:3001`) |
| `npm run db:migrate` | Schema + indexes |
| `npm run db:seed` | Admin + driver users |
| `npm run db:seed:fleet` | Extra dummy vehicles/drivers/clients |
| `npm test` | Vitest unit tests |
| `npm run lint` | ESLint |
| `npm run build` | Production frontend build |

## Docs & versioning

See [AGENTS.md](AGENTS.md) and [CHANGELOG.md](CHANGELOG.md). Root and `server/package.json` versions stay aligned. The `docs/` folder is local-only (gitignored).
