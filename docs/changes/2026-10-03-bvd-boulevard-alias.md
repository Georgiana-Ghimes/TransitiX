# Map/geocode: accept Bvd. as boulevard

`Bvd.` was missing from street-type abbreviations in `server/src/lib/geo/address.js`.
Typed as `Bvd. Iuliu Maniu, Bucuresti`, the parser did not see a street type, dropped the
street, and geocoded the city alone — wrong pin / km vs the same address with `Bd.`.

Also added `bvd` / `bld` in `src/lib/streetName.js` so zone lookup matches `Bd.` / `Blvd.`.
