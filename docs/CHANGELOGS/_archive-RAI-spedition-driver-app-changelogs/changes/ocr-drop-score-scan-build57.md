# Build 57 — OCR: drop_score 0.10 + scan deskew/de-rule

## Problemă

Chiar cu det_side 1920, Paddle putea întoarce gol: `drop_score=0.35` ștergea liniile
recunoscute la 0.1–0.3 (tipic handwriting).

## Schimbare

- `PADDLE_OCR_DROP_SCORE` default **0.10**
- Pass `scan_like_document`: deskew pe linii carnet, ștergere linii păstrând literele, binarizare
- Env pe ambele compose-uri

## Deploy

```bash
docker compose -f docker-compose.companion.yml up -d --build paddle-ocr
```
