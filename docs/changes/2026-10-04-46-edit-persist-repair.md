#46 Editează aviz: saved fields snap back from OCR repair

`GET` list/`decorateAviz` runs `repairAvizFromStored` (read-only). `preferTipMarfa`
took OCR packaging (saci/galeti) *before* keeping a non-unit stored string, so
office free text ("Beton") vanished on reopen. `preferQuantity` could replace a
saved count with "Numărul de găleți" unless `corrected_fields` pinned it.

Repair now keeps any filled non-`bucati` tip, honours `corrected_fields` on all
repaired columns, and still heals empty/bucati/first-line quantity for unpinned OCR rows.
Annex Tip marfă uses office text only when `tip_marfa` is pinned, so unpinned
product names still export as packaging from `quantity_unit`.
