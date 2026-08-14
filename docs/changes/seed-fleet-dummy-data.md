# Seed fleet / drivers / clients dummy data

## What

`server/src/seed-fleet-data.js` adds **12 vehicles**, **12 drivers**, and **12 clients** with varied statuses (active/inactive, disponibil/în cursă/concediu, etc.) for UI testing.

Safe to re-run: skips duplicates by plate, driver email/phone, client CUI/name.

## Run

```bash
# From repo root (requires Docker DB + server/.env)
npm run db:seed:fleet

# Or from server/
npm run seed:fleet --prefix server
```

Prerequisite: base seed at least once (`npm run db:migrate && npm run db:seed`).

## Verify

1. Open **Flotă** — expect ~14+ vehicles (2 base + 12 new, minus any plate clashes)
2. **Șoferi** — mix of disponibil, în cursă, concediu, indisponibil cards
3. **Clienți** — 12+ companies including one inactive
