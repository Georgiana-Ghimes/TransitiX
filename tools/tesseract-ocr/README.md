# Tesseract OCR sidecar — PARKED

Not wired into Transitix Node OCR (`readText.js`). Kept on disk for a later
handwriting experiment if Paddle + PaddleOCR-VL are not enough.

Both Paddle classic and PaddleOCR-VL run **on this PC** (Docker). Images never
leave the machine — same on-prem profile Tesseract would have had. The GDPR
risk to avoid is **cloud** OCR (e.g. Google Vision), not a local sidecar.

## Start (only if re-enabled)

```bash
docker compose -f docker-compose.tesseract-ocr.yml up -d --build
```

Then set `TESSERACT_OCR_URL=http://127.0.0.1:8102` and re-wire the gate in
`server/src/lib/ocr/readText.js`.
