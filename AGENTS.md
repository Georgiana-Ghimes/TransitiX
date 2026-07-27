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
- Prefer existing entity API patterns in `src/api/client.js` before adding new clients
- Keep multi-tenant isolation via `company_id` on all company-scoped queries
- Do not reintroduce Base44 SDK, plugins, or references
