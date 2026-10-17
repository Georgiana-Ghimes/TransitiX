# Build 61 — Re-extrage OCR în fundal + fail-fast paddle-down

## Problemă

Pe poze grele: `OCR_TIMEOUT` la bugetul interactiv; în spatele tunelului UI rămânea pe „Se re-extrage…”.

## Schimbare

- Re-extrage (`id` pe body) → 202 + fundal
- 503 dacă `ocrCapability() === paddle-down`
- Client abort 130s; Re-extrage disabled când e banner
- `failStaleUploadedAvize` pe `updated_at`
