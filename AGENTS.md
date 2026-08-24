# AGENTS.md

## Project Context

Transitix is a full-stack TMS (Transport Management System) app.

- Frontend: React + Vite in `src/`
- Backend: Express API in `server/`
- Database: PostgreSQL

## Key Files

- `src/api/client.js` — frontend API client (auth, entities, integrations)
- `src/lib/AuthContext.jsx` — JWT auth state
- `server/src/index.js` — API entrypoint
- `server/src/migrate.js` — DB schema
- `server/.env` — local DB/JWT config (do not commit secrets in production)

## Working Notes

- Run backend with `npm run dev --prefix server` (port 3001)
- Run frontend with `npm run dev` (port 5173, proxies `/api` and `/uploads`)
- Local Postgres: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db` (host port **5434**)
- Copy `server/.env.example` → `server/.env` (invented local secrets are fine; no teammate handoff required)
- Prefer existing entity API patterns in `src/api/client.js` before adding new clients
- Keep multi-tenant isolation via `company_id` on all company-scoped queries
- Do not reintroduce Base44 SDK, plugins, or references
- **Responsive:** office UI must work from ~360px (phone) through tablet to desktop. Prefer card layouts under `md`, tables from `md` up with `overflow-x-auto` + `min-w-*`. Do not hide critical actions only behind desktop-only UI.

## Documentation & versioning (mandatory for all agents)

Until a better permanent location is chosen, document **every meaningful change locally** before considering work done.

1. **`CHANGELOG.md`** — Keep a Changelog format. Put work under `[Unreleased]` while in progress; move to a dated `## [x.y.z] - YYYY-MM-DD` section when closing an increment.
2. **`docs/changes/`** — Add a short note per increment (e.g. `docs/changes/1.0.1-local-bootstrap.md`) describing what changed and how to verify. The whole `docs/` tree is gitignored (local only).
3. **Semver** — Keep root `package.json` and `server/package.json` versions aligned. A `post-commit` hook (`scripts/semver-post-commit.js`, installed via `npm run prepare`) bumps both from the commit message: `feat:` → minor, `feat!:` / `BREAKING CHANGE` → major, otherwise patch. Add `[skip version]` to skip. The UI reads this version (`src/lib/appVersion.js`).
 - **patch** — fixes, docs, tooling
 - **minor** — user-visible features
 - **major** — breaking API/schema
4. Do not leave undocumented behavior, API, or schema changes.
