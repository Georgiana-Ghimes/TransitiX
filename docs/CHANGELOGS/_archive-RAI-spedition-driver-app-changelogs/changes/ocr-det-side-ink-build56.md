# Build 56 — OCR: det_side 1920 + ink gray-world

## Cauza „nimic extras”

PaddleOCR redimensionează pagina la `det_limit_side_len` **960** înainte de detecție.
Upscale-ul din preprocess era aruncat; o linie de carnet ajungea ~22px — sub pragul DB.

## Schimbare

- `det_limit_side_len` / `PADDLE_OCR_DET_SIDE_LEN` default **1920**
- `fit_for_detector` — un singur resize la mărimea detectorului
- `emphasize_ink` — gray-world + lightness / blur local (nu `min(R,G)`)
- `bench.py` pentru măsurat pe poze reale
- env pe `docker-compose.companion.yml` + `docker-compose.paddle-ocr.yml`

## Deploy

```bash
docker compose -f docker-compose.companion.yml up -d --build paddle-ocr
```

Obligatoriu **rebuild** (nu doar restart) — `app.py` e în imagine.
