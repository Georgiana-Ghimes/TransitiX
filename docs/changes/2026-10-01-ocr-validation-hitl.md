# 2026-10-01 — OCR validation + HITL routing (avize RAI)

## Increment 1–3

- `avizFieldSchema.js` — câmpuri OCR vs manual, praguri pe 3 benzi (critice mai stricte)
- `validateAviz.js` — TPO, dată, duplicate 90z, plăcuță/cantitate; routing auto / hitl_optional / hitl_required
- Extract path persistă `extracted_data.validation` + `ocr_blocks`; `needs_review` din routing
- List API: `fieldConfidenceForUi` (scoruri OCR, heuristică doar fallback)
- Confirm gate pe `/avize/bulk-confirm`, `/avize/doc/:id/confirm`, entity PUT
- HITL API: `GET /documents/review-queue`, `GET /:id/review`, `POST /:id/approve-review`; corrections audit old→new
- UI: `AvizReviewDrawer` + buton Verifică pe `/avize`
