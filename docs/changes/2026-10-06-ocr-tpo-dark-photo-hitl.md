# OCR #56: TPO pe foto slabă fără marcaj HITL

- `refineFieldsWithBlocks` amestecă încrederea structurală cu scorul blocului OCR (sau media paginii ≤0.80 pe câmpuri critice).
- `extractDocument` / `reExtract` primesc `blocks`; documentele cu TPO/placă/dată sub HITL auto (0.90) rămân în review.
- `fieldConfidenceForUi` preferă `confidence` numeric față de `status === 'ok'` → portocaliu sub 0.90.
