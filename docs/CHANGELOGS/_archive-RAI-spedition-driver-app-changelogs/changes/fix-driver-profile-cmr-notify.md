# Fix — driver profile logout + CMR office visibility

## Bugs / gaps

1. Driver **Profil** tab crashed (white page): lucide icons used without import.
2. Driver CMR upload already called `notifyCmrPending`, but notify failures could break the write path; message lacked driver name; admin had no dedicated list outside the bell / trip detail.

## Fix

- Import icons + use AuthContext `logout` in `DriverProfile.jsx`
- Best-effort notify on TripDocument create/update; include `driver_name`
- Documents: section **CMR încărcate de șofer** (unconfirmed `TripDocument` → trip link)
