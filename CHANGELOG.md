# Changelog

All notable changes to TransitiX are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/). Root and `server/package.json` versions stay aligned.

## [Unreleased]

## [1.1.6] - 2026-08-14

### Added

- `/api/search` — server-side office search (no more prefetching 700+ rows in GlobalSearch)
- DB indexes for trips, clients, invoices, chat, driver notifications, trip documents

### Changed

- Lazy-loaded heavy routes (GPS, Planning, Finance, DriverApp, etc.) — main JS bundle ~75% smaller
- GlobalSearch: debounced API search instead of full catalog download
- Notification inbox: SQL-filtered expiry queries, 5 min cache, batch mark-all-read
- NotificationBell: polls every 2 min only when browser tab is visible
- DriverApp: server-side trip filter by `driver_id` (50 rows max)
- API: gzip compression, 1 MB default JSON limit, upload cache headers
- Postgres pool tuning (`max`, idle/connection timeouts)

## [1.1.5] - 2026-08-14

### Added

- Vitest unit tests for `notify`, `roles`, `utils`, toast reducer, `entities`, and JWT auth middleware
- GitHub Actions CI on `main` PRs/pushes: lint, `npm test`, frontend build
- `npm run db:seed:fleet` — incremental dummy data for Flotă, Șoferi, and Clienți

### Fixed

- Șoferi cards: inactive drivers show **Reactivează** / **Șterge** instead of always showing Dezactivează
- Toasts: 3s auto-dismiss, visible progress bar, smooth fade-out, working close (X), max 3 visible

## [1.1.4] - 2026-08-13

### Changed

- Curse, Șoferi, Clienți, and Depozit: native `confirm()` replaced with shared `ConfirmDialog` (delete / deactivate)

## [1.1.3] - 2026-08-13

### Fixed

- Notification inbox stays on-screen on phone (viewport-pinned panel instead of overflowing the bell)
- Local Vite proxy uses `127.0.0.1` (avoids Windows IPv6 `localhost` ECONNREFUSED to the API)

## [1.1.2] - 2026-08-13

### Added

- Vehicle form: inline field errors + in-modal banner (numeric overflow, year, required fields)
- Shared `FormFeedback` helpers for field/banner errors inside modals

### Fixed

- Toasts sit above modal overlays (`z-[200]`) so they are not hidden on mobile
- Friendlier copy for Postgres `integer out of range`

## [1.1.1] - 2026-08-13

### Fixed

- Replaced remaining native `alert()` calls with toast notifications across forms and workflows (vehicles, drivers, clients, trips, invoices, warehouse, driver app, OCR, planning, client portal)
- Friendlier Romanian copy for common Postgres errors (numeric overflow, unique/duplicate)

## [1.1.0] - 2026-08-13

### Added

- Reusable in-app `ConfirmDialog` (replaces native `confirm` on Flotă)
- Local Docker Postgres overlay (`docker-compose.dev.yml`, host port 5434)
- `server/.env.example`, agent changelog rules, `docs/changes/` notes
- Mobile card layouts for Curse, Financiar, Depozit, and Dashboard recent trips
- Mobile global search bar under the office header (viewports below `lg`)

### Changed

- Responsive sweep for common viewports (~360px phone → tablet → desktop)
- GPS map uses viewport-relative height on small screens; list/map stacking order improved
- Auth screens: tighter padding, `100dvh`, safe-area insets
- Viewport meta: `viewport-fit=cover`; reduce iOS input zoom; prevent horizontal page scroll

### Fixed

- Fleet: inactive vehicles could not be removed — Reactivate + permanent Delete
- Fleet: native browser alerts replaced with ConfirmDialog + toast feedback

## [1.0.0] - 2026-08-13

### Notes

- Baseline: upstream `main` as received (Express + PostgreSQL TMS, Docker Compose on 8082).
