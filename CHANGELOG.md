# Changelog

All notable changes to TransitiX are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/). Root and `server/package.json` versions stay aligned.

## [Unreleased]

## [1.8.2] - 2026-08-19

### Fixed

- Avize bulk confirm no longer spams duplicate requests; button disables when all selected rows are already confirmed
- Avize export (Unește) and Zip buttons disable while a request is in flight
- Date preset buttons (Azi / Săptămâna asta / Luna asta) show active styling; Resetează clears preset state
- PDF/image preview in Editează fills more of the modal on desktop

## [1.8.1] - 2026-08-19

### Added

- Rapoarte Avize arată cine a exportat (`user_id` / nume / email) pe istoricul de anexă
- Avize legate pe detaliul cursei; toast când lista de flotă / șoferi / clienți / documente / dashboard eșuează
- Pagină Avize spartă în componente (`src/pages/avize/`) fără schimbare de flux

### Security

- Limită 60 upload-uri / minut / firmă pe `POST /api/integrations/upload`

### Tests

- Reguli API Avize: ciornă doar din `confirmed`, lock Anexa Factura RAI la delete/update

### Fixed

- Login/register pornesc din nou: middleware `rateLimit` reexportat lângă `hitRateLimit`

## [1.8.0] - 2026-08-19

### Added

- Production foundation vs Romanian TMS market: plan in `docs/romania-tms-production.plan.md`
- Câmp UIT (manual), CUI expeditor/destinatar, venit/cost și marjă pe cursă
- Numere de factură secvențiale per serie (`invoice_counters`), folosite și la ciorna din avize
- `GET /api/health` raportează capabilități reale (`gps: simulate`, `efactura: false`, Vision, email)
- Banner **demo** pe GPS, Planning AI și e-Factura; meniul marchează GPS/Planning ca demo

### Security

- Upload-urile noi sunt prefixate `c-{company_id}-…`; `GET /uploads` refuză fișierele altei firme (legacy: doar dacă rândul e în DB)

### Changed

- Avize search is debounced and does not treat `%` / `_` as wildcards; bulk confirm skips already-confirmed rows; email stub downloads the annex from one response; preview uses Authorization (no JWT in the iframe URL); locked Anexa Factura RAI cannot be deleted from the UI
- Financiar nu mai marchează facturi ca trimise la ANAF; emailul de factură cere adresa de pe cursă (nu `client@exemplu.ro`)
- `POST /api/avize/extract` e limitat la 30 cereri / minut / firmă

## [1.7.1] - 2026-08-19

### Changed

- Office sidebar, login, driver app footer, tab title, and `/api/health` read the version from `package.json`, so a stale Vite inject can no longer keep showing an old number

## [1.7.0] - 2026-08-19

### Added

- Avize list filters (`from` / `to` / `status` / `q`, max 200) with Azi / Săptămâna asta / Luna asta (`Europe/Bucharest`)
- `extraction_source` badge (`pdf-text` | `vision` | `stub`) and field-confidence highlight on TPO / auto / rută
- Duplicate TPO warning on save/upload (same company); save stays allowed, no UNIQUE index
- File preview in Editează (JWT upload URL); optional office `ruta_display` (Excel route unchanged)
- Bulk confirm, observation-code chips, email annex (Resend or stub + download), zip of XLSX + original files
- Optional `trip_id` with plate/date suggestions; draft invoice from confirmed avize (no e-Factura ANAF)
- Rapoarte tab: km per plate, weekly counts, export history; default Anexa Factura RAI cannot be overwritten
- Google Vision module `avizVision.js` and VM runbook `docs/ops-google-vision.md` (no secrets in git)
- ClickUp documentation pack (`docs/clickup/`): Romanian **Spec MVP V2** and **Avize stare + plan**
- CI runs lint, unit tests, and frontend build on **every push and pull request** (not only `main`)
- Unit test that Editează form fields stay aligned with Anexa XLSX sources
- Avize / Rapoarte implementation checklist (`docs/avize-planning-checklist.md`)

### Changed

- Street parser also accepts Blvd / Bld / Aleea / Al. / Pța / Piata / Pta
- Re-extract keeps office km/taxe/observatii and `ruta_display`

### Tests

- Parser street aliases, list-query filters, duplicate TPO flags, zip store, date presets, Vision text-poor, locked RAI template

## [1.3.2] - 2026-08-19

### Added

- App version (`vX.Y.Z`) in the office sidebar footer and on auth pages (login / register / password reset)
- Git `post-commit` hook bumps aligned `package.json` versions from the commit message (`feat:` minor, breaking major, otherwise patch). Skip with `[skip version]`

## [1.3.1] - 2026-08-19

### Security

- `/uploads/:filename` requires a JWT (Authorization header or `?access_token=` for `<img>`); aviz/CMR files are no longer world-readable
- Drivers can no longer list or mutate office entities (Avize, invoices, vehicles, warehouse, GPS, templates). Trip updates are limited to status and mileage fields
- Login email is globally unique (`LOWER(email)`); register runs in a transaction so a unique race cannot create two companies

### Fixed

- Re-extract keeps office km/taxe/observatii and does not demote Confirmat
- Avize `load()` ignores stale responses; row actions disable while Re-extrage runs
- Default report template, template delete, GPS `is_current`, warehouse +/- qty, password-reset token, client confirm, and CMR pending notification are atomic (unique indexes + transactions)
- Dispatcher trip save omits unchanged status so it cannot roll back a driver `in_tranzit` update
- Upload filenames include a UUID so two files at the same millisecond do not collide

### Tests

- Unit tests for merge-on-reextract, driver ACL, unique upload names, warehouse qty clamp, trip status omit, repair no-op, and authenticated upload URLs

## [1.3.0] - 2026-08-18

### Added

- Office module **Avize / Rapoarte**: upload Baumit-style avize (PDF/photo), extract TPO/date/plate/route/qty, edit the Anexa Factura RAI table, manage XLSX templates, merge selected rows into one annex XLSX
- Avize / Rapoarte action legend (Confirmă, Re-extrage, Editează, Șterge, Unește; Șabloane tab explains how templates apply to export)
- Unit tests that build the Anexa XLSX (default 14 columns and custom Șablon nou: Taxă 100 / Tarif km 20)
- Manual Avize / Rapoarte test checklist (`docs/changes/1.3.0-avize-manual-checklist.md`)

### Fixed

- Aviz parser: Numar TPO only accepts `TPO-…` (ignores product names like MPI / Adeziv and address lines)
- Manual TPO on Editează is kept after reload (repair no longer wipes a typed TPO when the PDF has none)
- Editează keeps date, auto, rută, and document number; reload no longer restores PDF values (use **Re-extrage** to take the file again)
- Avize toolbar: template dropdown lines up with Încarcă / Foto / Unește (hint text no longer lifts the select)
- Repeated uploads of the same BUILDTEST PDF no longer land as empty **Încărcat** rows (`pdf-parse` `bad XRef entry` is retried)
- Ruta transport is Client address → Adresă de livrare (e.g. `Bucuresti/Aeroportului120-T-Bucuresti/Viilor52`), not Expeditor Site BOL/MIL; Site is only a fallback on TRO
- Numar auto keeps tractor and trailer plates (`B-112-VFM / B-475-AGR`); unlabeled PDFs no longer dump the whole document into Auto
- Custom Anexa templates keep their columns and Default values on export (Taxă 100 / Tarif km 20 were ignored: incomplete templates were replaced, and stored 0 blocked defaults)
- Anexa XLSX headers match the client sheet (14 columns A–N, including km / tarif / observații)

## [1.2.0] - 2026-08-18

### Added

- Company Settings API (`GET/PUT /api/company`) wired to Setări (profile + document-expiry thresholds)
- Resend email when `RESEND_API_KEY` + `EMAIL_FROM` are set; console stub otherwise (invoices + password reset)
- `POST /api/auth/refresh` (tied to `company_id`); client stores refresh token and retries once on 401
- Login/register rate limit (20 / 15 min)
- Expanded README: product map, stubs, Docker DB on 5434, seed accounts, Compose/VM notes

### Changed

- `/api/health` reports database connectivity
- Entity delete is office-only (drivers cannot delete company records)
- Company profile writes (`PUT /api/company`) are admin-only
- Documente expiry horizon follows company settings
- Compose/API env documents Resend; JWT_SECRET required at API start

### Removed

- Unused Stripe and drag-and-drop frontend packages

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
