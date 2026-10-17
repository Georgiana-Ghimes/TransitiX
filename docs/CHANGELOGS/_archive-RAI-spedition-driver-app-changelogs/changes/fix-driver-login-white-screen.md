# Fix — driver login white screen (office tour loop)

## Cause

`Layout` always opened the office first-visit tour. The tour `useEffect` navigated to `/`
while the driver shell redirected non-`/driver-app` paths back to `/driver-app` → blank loop.

## Fix

- Skip / close office tour when `isDriverRole(user)`
- Guard all tour navigation / highlight effects for drivers
- Auth logout with redirect no longer clears user state before `location.href` (avoids the same Navigate fight on logout)
