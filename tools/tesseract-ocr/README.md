# Tesseract OCR sidecar (Romanian)

Sidecar on **:8102** — `tesseract` + `ron` tessdata, with light OpenCV preprocess for carnets.

Runs **beside** classic PaddleOCR on :8100 (and optional PaddleOCR-VL on :8101). Node picks the best text — see `server/src/lib/ocr/readText.js`.

## Start

```bash
docker compose -f docker-compose.tesseract-ocr.yml up -d --build
```

- Health: http://127.0.0.1:8102/health

## Env (Node)

```env
OCR_PROVIDER=paddle
PADDLE_OCR_URL=http://127.0.0.1:8100
# optional VL (if you run that sidecar)
# PADDLE_OCR_VL_URL=http://127.0.0.1:8101
TESSERACT_OCR_URL=http://127.0.0.1:8102
```

## Hybrid order (Node)

1. PDF text layer  
2. **Paddle classic** (fast)  
3. If thin / no TPO|PSL|TRO → **Paddle VL** (when URL set)  
4. If still weak → **Tesseract ron+eng**  
5. `pickBestOcrText` keeps the richest candidate (logistics codes > length > RO diacritics)

Tesseract is the third gate on purpose: strong on printed RO diacritics and a useful second opinion on handwriting, but slower to help alone on messy carnets than Paddle+VL.

## Tessdata

The Docker image installs `tesseract-ocr-ron` from Debian. For a manual `ron.traineddata`, see [tessdata](https://github.com/tesseract-ocr/tessdata) and set `TESSDATA_PREFIX`.

## Knobs

| Env | Default | Meaning |
|-----|---------|---------|
| `TESSERACT_LANG` | `ron+eng` | OCR languages |
| `TESSERACT_PSM` | `6` | Page segmentation (uniform block) |
| `TESSERACT_OEM` | `3` | LSTM engine |
| `TESSERACT_OCR_PDF_PAGES` | `8` | Max PDF pages rasterized |
