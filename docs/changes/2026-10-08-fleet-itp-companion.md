# ITP under Flotă (companion)

Companion office nav: parent **Flotă** with **Autoturisme** (`/fleet`, MTMA) and **ITP** (`/fleet/itp`, expiry board).

- New screen: list active vehicles, filters (expired / soon / missing), KPI strip, edit `itp_number` + `itp_expiry` via `RoDateField` → `Vehicle.update`.
- Fleet list already `SELECT *` (includes `itp_*`); Autoturisme shows a small “ITP expirat” badge → `/fleet/itp`.
- Companion bell: `document_expiry` links from `/vehicles` rewrite to `/fleet/itp`.

## Periodicitate automată (RNTR 1)

- `src/lib/itpSchedule.js`: `nextItpExpiry` / `rollItpExpiry` — default **transport marfă = +12 luni**.
- Board ITP: coloană „Următoarea (est.)”; în drawer „ITP făcut — derulează și salvează”.
- Data de pe talon rămâne editabilă manual.

Changelog #7 append + companion bump at commit+push.
