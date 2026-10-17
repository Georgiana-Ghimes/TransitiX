# Build 54 — OCR carnet: ink first + det sensibile + timeout 120s

## Problemă

Poza de carnet (cerneală albastră, fundal monitor verde) tot nu extrăgea nimic după build 53:
pass-urile raw pe RGB gol consumau timeout-ul interactiv (45s) înainte de enhance/ink;
pragul de detecție Paddle (~0.6) ignora trasăturile fine.

## Schimbare

- `tools/paddle-ocr/app.py`: `ocr_photo_page` — întâi `emphasize_ink` + upscale, apoi rotații și pass-uri agresive; `det_db_box_thresh` / `drop_score` mai jos (env override).
- `interactiveOcrTimeoutMs` default 120s (env examples + teste).

## Deploy

Rebuild + restart `paddle-ocr` pe VM (codul e în imagine):

```bash
docker compose -f docker-compose.companion.yml up -d --build paddle-ocr
```

Apoi re-extract pe poza de carnet.
