#45 Taxă zonă: Șos. Viilor 52 (PSL-0056102)

`avizDeliveryAddress` treated locality as a city only on an exact `bucuresti` fold.
`sector 5, București` became `supported: false` → `outside_city` in Editează, and the map
link passed `locality=` which skipped the street index.

Also: pin-only tooltips always said „în afara zonelor pe hartă” because polygon zone was
nulled so Photon could not flash ZA — the caption now uses `resolveAddress` from the index.

Index (PMB): Șoseaua Viilor even 4–98 = **ZB**. Ticket paper said Zona A; we do not invent ZA.
