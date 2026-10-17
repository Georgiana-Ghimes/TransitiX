# Greutăți goale pe PDF multi-page (ä OCR)

**Batch:** `07.10.2026.BAU.pdf` (28 avize, 1/pagină).

**Simptom:** 23/28 fără `gross_weight_kg` / `net_weight_kg`; cantitate/TPO/auto OK.

**Cauză:** Mistral citește etichetele ca `Greutate brutä` / `netä` (U+00E4), iar regex-urile așteptau doar `bruta|brută` / `neta|netă`. Cele 5 cu `bruta` ASCII au extras greutățile.

**Fix:** `sanitizeOcrText` mapează `ä→ă` / `Ä→Ă` înainte de extracție. Test pe linia reală din batch. Re-aplicat extract pe `raw_text` stocat → 22 recuperate; aviz 21/28 fără linie „Greutate” în OCR.
