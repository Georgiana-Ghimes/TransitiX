# Build 55 — OCR foto: corecție perspectivă OpenCV

## Ce

Pe path-ul foto (`ocr_photo_page`), înainte de ink / rotații / OCR:

1. Detectează cel mai bun quad de pagină (Canny + adaptive threshold).
2. Warpează la dreptunghi (`getPerspectiveTransform`).
3. Dacă nu găsește pagină sigură (full-bleed, aspect absurd) → lasă imaginea neschimbată.

## Fișiere

- `tools/paddle-ocr/app.py` — `correct_perspective`, `find_page_quad`, `order_quad_points`
- `tools/paddle-ocr/check_logic.py` — teste sintetice (trapez pe birou)

## Env

- `PADDLE_OCR_PERSPECTIVE=0` — oprește warp-ul

## Deploy

```bash
docker compose -f docker-compose.companion.yml up -d --build paddle-ocr
```
