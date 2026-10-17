# Zone map: aviz leg `Bvd. Iuliu Maniu nr. 600A, Bucuresti`

## Problem
Pasting the delivery leg from an aviz onto the zone map returned "unknown": the trailing
`, Bucuresti` blocked house-number splitting, so the street index never saw
`Bulevardul Iuliu Maniu` + `600A`.

## Fix
- `lookupAddress` peels a trailing locality (letters only; not `, 12` / `, bl. A`) before
  looking up / splitting the number.
- Geocode queries expand `Bvd.`/`Bd.`/`str.` to full type words (`geocodeStreetQuery`).

## Note
Nr. 600A on Bd. Iuliu Maniu is outside restricted zones in the index (even side 52–646
unrestricted) — the map should say "În afara zonelor", not "negăsit".
