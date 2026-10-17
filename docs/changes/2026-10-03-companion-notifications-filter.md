# Companion: clopoțel fără notificări de curse

Pe `VITE_APP_PROFILE=documents`, inbox-ul din clopoțel filtrează tipurile Transitix full (status cursă, CMR pe trip, client, live) și păstrează ce are sens aici: upload șofer, expirări Autoturisme, alerte MTMA / date pe `/avize`·`/reports`·`/fleet`.

- `src/lib/companionNotifications.js`
- `NotificationBell` recalculează badge-ul pe lista filtrată
- `/vehicles` → `/fleet` la click
