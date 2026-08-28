# Local PaddleOCR for Transitix

Sidecar HTTP service used by the Node API for photo / scanned-PDF OCR when
`OCR_PROVIDER=paddle` (see `server/.env`).

## Why Docker?

This machine may only have Python 3.14 and no NVIDIA GPU. PaddleOCR needs
Python ≤3.12 and (optionally) CUDA. The Docker image uses **Python 3.10 + CPU**.

## Start

From the repo root:

```bash
docker compose -f docker-compose.paddle-ocr.yml up -d --build
```

First build downloads wheels + models (several minutes). Then:

- Health: http://127.0.0.1:8100/health  
- OCR: `POST /ocr` (multipart `file`) or `POST /ocr/json` (`{ "image_base64": "..." }`)

## Wire Transitix

In `server/.env`:

```env
OCR_PROVIDER=paddle
PADDLE_OCR_URL=http://127.0.0.1:8100
# Optional fallback if paddle is down:
```

Restart the API (`npm run dev` in `server/`). Upload an aviz photo from the
driver app or Avize page — `readDocumentText` will call Paddle for images.

## Language

Default `PADDLE_OCR_LANG=latin` covers Romanian diacritics reasonably. For
Chinese docs use `ch`. Set via compose env or `.env`.

## Auto-rotate

By default the service tries page orientations `0 → 90 → 270 → 180` when the
first pass scores poorly (missing TPO/PSL/keywords). Disable with
`PADDLE_OCR_AUTO_ROTATE=0`. Response includes `rotation` (degrees clockwise).

Transitix Node also post-corrects codes/plates (`PS-…` → `PSL-…`, `B330SRS` →
`B 330 SRS`) in `server/src/lib/ocr/normalizeOcrText.js`.

## Stop

```bash
docker compose -f docker-compose.paddle-ocr.yml down
```

## Verificarea logicii, fără motorul OCR

`check_logic.py` rulează tot ce e în jurul recunoașterii — rasterizarea PDF, plafonul de pagini,
raportarea trunchierii, căutarea orientării — cu PaddleOCR înlocuit de un dublu. Așa se poate
verifica partea care decide *ce* se citește, pe o mașină fără sute de megaocteți de dependențe ML:

```bash
python tools/paddle-ocr/check_logic.py
```

În container, unde e deja totul instalat:

```bash
docker compose -f docker-compose.companion.yml exec paddle-ocr python /app/check_logic.py
```

Iese cu cod diferit de zero dacă vreo verificare pică. Nu atinge PaddleOCR — pentru asta trebuie
împins un aviz real prin `/avize`.
