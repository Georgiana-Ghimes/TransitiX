# #85 Praguri OCR prea stricte

## Problemă

HITL auto era 0.90, iar `ACCEPT_CONFIDENCE` / status `ok` era 0.80. Extractorul marca câmpuri „ok” la 80–88 %, dar documentul tot cerea verificare. În plus, media blocurilor pe pagină ≤ 0.80 forța plafon pe TPO/placă/dată (#56) — pe foto tipice Mistral aproape totul intra în review.

## Remediere

- `DEFAULT_BANDS` / `CRITICAL_BANDS` auto → **0.80** (aliniat cu ACCEPT)
- optional → 0.50 / 0.55
- `WEAK_PAGE_BLOCK_CONFIDENCE` → **0.60**; pe pagină slabă plafon = optional − 0.01 (HITL_REQUIRED, păstrează #56)
- UI amber + textele din ghid: 80 %
