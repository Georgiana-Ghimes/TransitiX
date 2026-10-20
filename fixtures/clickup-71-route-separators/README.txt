ClickUp #71 — Route separators → zone tax (Viilor / București)

Folder: fixtures/clickup-71-route-separators/

  pdf/   — one PDF per separator variant (upload on Avize OCR)
  png/   — same content as "photo" (upload Foto / drag-drop)
  00_all-12-variants.pdf — all 12 pages in one file
  manifest.json — TPO / PSL / expected per file

Naming:
  01..06  — BOL Bolintin + separator + Șoseaua Viilor nr. 52, București
            separators: →  |  ->  |  -  |  –  |  —  |  /
  07..10  — origin includes Bolintin-Deal (glued hyphen) + separator + Viilor
  11      — delivery only (no separator)
  12      — NEGATIVE: only Bolintin-Deal (must NOT get București zone tax)

How to test on VM:
  1. Avize OCR → Încarcă avize (PDF) or Foto (PNG)
  2. Open Editează — check Rută keeps destination after separator
  3. Taxă zonă panel should show "Taxă zonă București ZB" for 01–11
     (MTMA needed for lei amount; B 112 VFM is on the fixture)
  4. File 12 must say delivery is not in a taxed city

Also see: src/lib/fixtures/route-separators-71-manual.txt (paste into Rută)
