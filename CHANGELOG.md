# Changelog

All notable changes to TransitiX are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/). Root and `server/package.json` versions stay aligned.

## [Unreleased]

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
