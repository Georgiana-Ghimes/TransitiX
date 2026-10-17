HITL thresholds: auto from 90%; duplicate is info only

Operators asked not to review a ~90% OCR score, and not to be blocked
by „Suspect de duplicat”.

- `DEFAULT_BANDS` / `CRITICAL_BANDS` auto → 0.90 (optional 0.65 / 0.70)
- `duplicate_suspect` finding → severity `info`; ignored in `computeRouting`
