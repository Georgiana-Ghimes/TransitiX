# Hybrid OCR (Paddle det + TrOCR ONNX) — 2026-09-24

Sidecar `tools/paddle-ocr` on PATH B (`text_detector` + `text_recognizer`).

## Enable
- `HYBRID_OCR=1` (default in compose)
- Models under volume `~/.paddleocr/onnx/` (`OCR_ONNX_DIR`):
  - `trocr-small-handwritten-v1-encoder.onnx`
  - `trocr-small-handwritten-v1-decoder.onnx`
  - `tokenizer.json`
- Export (host/one-shot, not serve image): `python scripts/export_trocr_onnx.py`
  (needs torch + transformers + sentencepiece + pillow; greedy decode only)

## Routing
- Heuristic printed/HW classifier (`HW_BIAS=1` → ambiguous → HW)
- TrOCR only when HW **and** paddle conf `< HANDWRITING_PADDLE_KEEP` (0.55), or printed with paddle conf `< PRINTED_FALLBACK_CONF` (0.5)
- TrOCR accepted only if conf ≥ `HANDWRITING_THRESHOLD` (0.75) and len ≥ `HANDWRITING_MIN_LEN` (2); else `paddle_fallback`
- Concurrency: asyncio lock (one OCR at a time)
- `TROCR_UNLOAD_AFTER_REQUEST=1` drops ORT sessions after each request (host RAM)

## Endpoints
- `/health` — `hybrid`, `trocr_available`, counters
- `/ocr` `/ocr/json` — `lines[]` with `source`/`style`, `stats`
- `/debug/classify` — style on one crop
- `test_handwriting.py` — CLI line dump

## HW photo progress (continued)

- Fixed multi-pass dump (no more concatenated garbage).
- Hybrid runs on ink + best prep (scan); field-merge only when not thin.
- `ro_post.normalize_ro_document` + label/code/plate/date repairs (RO).
- Block-cap carnets (e.g. short list): often usable codes/dates; cursive still weak.
