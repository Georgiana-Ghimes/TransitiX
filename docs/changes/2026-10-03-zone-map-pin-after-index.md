# Zone map pin for index hits + PHOTON_URL

## Why "not found on the map"
The street index answered Bvd. Iuliu Maniu for the zone card, then returned early without
geocoding — Leaflet never got a pin. With PHOTON_URL unset, the fallback also could not place one.

## Fix
- After an index hit, still call locateZone for coordinates (soft-fail if geocoder down).
- Pass loaded index on the lookup result so zone-by-number works on first search.
- Strip open-city label without a comma (... 600A Bucuresti).
- Local .env / .env.companion: PHOTON_URL=https://photon.komoot.io (dev stopgap).

Restart the API after the env change.
