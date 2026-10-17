# OCR #69: carnet slot 7 — cantitate `18.5 m3`

Pe ghidul 1–14, linia `7. 18.5 m3` lăsa Cantitate goală. Cauza e unitatea cu cifră, nu layout-ul.

- `qtyFromBareLine` folosește `extractQuantity` (știe m3/m³/mc) + pattern explicit; nu mai taie unitatea la `m`.
- Rezultat: Cantitate 18.5, `quantity_unit` m³.
