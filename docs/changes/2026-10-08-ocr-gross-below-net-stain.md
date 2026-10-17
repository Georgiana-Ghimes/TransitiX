# OCR #73: Greutate brută inventată când o cifră e acoperită

Pată pe `17.004,82` → OCR `1.704,82` scris ca brută, fără warning; neta 16.700,88 rămânea corectă.

- `extractGrossWeight`: dacă există netă etichetată și brută &lt; netă → `NO_MATCH` (câmp gol).
- Validare `gross_below_net` → HITL dacă totuși ajunge o valoare.
