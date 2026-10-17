# PDF bulk → avize separate (pe pagini)

La upload, un PDF cu mai mult de o pagină este despărțit automat în câte un `aviz_documents` per pagină (max. 40). OCR și confirmarea rulează pe fiecare rând. Re-extract pe un id existent nu re-desparte.

Cale: `POST /api/avize/extract` (companion) și `POST /api/documents/batches`. Răspunsul extract poate include `split_pages` + `documents[]`.
