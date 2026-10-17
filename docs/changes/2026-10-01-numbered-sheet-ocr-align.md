# Numbered driver sheet OCR = DRIVER_SHEET_GUIDE 1–14

The companion writing guide and OCR slot map must stay identical. Cab photos with a
PSL on the document-number line were previously mis-detected as Baumit printed avize.

## Layout (current)

1 TPO · 2 data · 3 valoare TPO · 4 auto · 5 rută · 6 tip marfă · 7 cantitate ·
8 greutate brută · 9 greutate netă · 10 nr. document · 11 nr. curse ·
12 taxe · 13 km · 14 tarif km

## Change

- `DRIVER_SHEET_FIELD_BY_NO` / `DRIVER_SHEET_GUIDE` / carnet_bord numbered fallbacks: **14** slots.
- Slot 8 = gross, 9 = net (was a single weight + shifted doc/trips).
- Blank optional lines stay empty; same-line whitespace after `N.` only.
- Detection: ≥5 filled numbered slots boosts `carnet_bord` over a lone PSL/TRO marker.
- `EXTRACT_COLUMNS` keeps slots 3 / 12–14 so annex figures are not dropped after extract.
