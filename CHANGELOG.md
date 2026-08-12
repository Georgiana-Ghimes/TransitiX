# Changelog

All notable changes to TransitiX are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/). Root and `server/package.json` versions stay aligned.

## [Unreleased]

### Fixed

- Fleet: inactive vehicles could not be removed — Flotă now supports Reactivate and permanent Delete (`Șterge`) after deactivate

### Added

- Feature branch workflow notes and local Docker Postgres overlay (`docker-compose.dev.yml`)
- `server/.env.example` for local invent-your-own secrets
- Agent documentation rules in `AGENTS.md` + `docs/changes/` notes

## [1.0.0] - 2026-08-13

### Notes

- Baseline: upstream `main` as received (Express + PostgreSQL TMS, Docker Compose on 8082).
