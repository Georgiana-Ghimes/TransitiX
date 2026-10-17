# 2026-10-01 — OCR „ready”: Faza 4 feedback, overlay bbox, preprocesare, graniță post-OCR

Companion **v1.12.0 / build 70** · branch `MISTRAL-experimenting-rai-documents`.

## Schema

- `document_events.kind` acceptă și `review_approved` (CHECK rescris cu `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`, în baseline — pe branch nu există `server/src/migrations/`). Fără asta `POST /documents/:id/approve-review` pica pe constraint.
- Index nou `idx_document_events_company_kind (company_id, kind, created_at DESC)` pentru agregarea de feedback.
- `ocr_text_cache.blocks JSONB` — blocurile normalizate se cachează lângă text; `OCR_PIPELINE_VERSION` 2 → 3, deci intrările vechi (fără blocuri) se recitesc o singură dată.

## Server

- `lib/ocr/ocrBlocks.js` — formă normalizată a blocurilor OCR, independentă de provider: `{ page, type, text, confidence, bbox{x0,y0,x1,y1}, page_width, page_height }`. Acceptă bbox ca obiect `x0..`, `top_left_*`, `{x,y,w,h}` sau array; confidence număr / procent / array / obiect. Text plafonat la 400 caractere, max 400 blocuri. `mistralOcr.js` trece `pages[]` prin `normalizePages` (înainte pierdea indexul paginii și dimensiunile).
- `lib/ocr/normalizeOcrText.js` — `sanitizeOcrText` rulează înaintea oricărei corecții de cod: NFC, fără control chars / zero-width / NBSP, ghilimele și liniuțe ASCII, fără rigle markdown / box-drawing / runs de simboluri, linii trimuite, max o linie goală. Idempotent. `normalizeOcrText` îl apelează primul, deci `extractDocument` vede același text indiferent de sursă (Mistral, pdf-parse, fixture).
- `lib/ocr/feedback.js` (Faza 4):
  - `avizOcrFieldChanges(prev, data, user)` — diff doar pe câmpurile OCR (nu km/tarif/valoare), tolerant la DATE pg vs `YYYY-MM-DD` și la NUMERIC string vs număr.
  - `summariseFeedback({events, documents})` — câmpuri corectate (documente, rată, exemple), touch rate per bandă de rutare, reguli picate, operatori, sugestii (`field_hot` > 30 %, `noise` opțional neatins > 70 %, `miss` auto corectat > 15 %, `rule_hot` > 50 %) **doar** peste 10 documente.
- `PUT /entities/AvizDocument/:id` — o editare din formularul office pe un câmp OCR loghează `corrected` cu `field_changes` (`via: 'office_form'`) și adaugă câmpul în `corrected_fields`, în aceeași tranzacție. Până acum doar drawer-ul HITL producea evenimente, deci bucla de feedback vedea o fracțiune din corecții.
- `GET /documents/feedback?from&to` — fereastră implicită 30 zile; evenimente `corrected` + documente cu OCR rulat (`status <> 'uploaded'`) create în fereastră.

## Client

- `src/lib/ocrBlocks.js` — potrivire câmp ↔ bloc (`looseText` pliază O/0, I/L/1, diacritice; dată ISO → `DDMMYYYY`; numeric cu/fără zecimale), `blockRect` în procente pentru wrapper-ul care îmbrățișează imaginea, `blocksForValue`, `isLowConfidenceBlock` (< 0.70).
- `AvizFilePreview` acceptă `overlay(natural)` (doar imagini; PDF e iframe). `AvizBlockOverlay` desenează: albastru = câmpul activ, chihlimbar = citire nesigură, gri = toate (opțional). Click pe bloc preia textul în câmpul activ.
- `AvizReviewDrawer` — câmp activ la focus/hover pe problemă, contor „N bloc(uri) în poză / nu găsesc valoarea”, toggle „toate blocurile”.
- `OcrQualityCard` în tab **Sinteze** pe `/avize`: documente citite, atinse de om, corecții, touch rate pe bandă, top câmpuri corectate cu exemplu, reguli picate, sugestii (sau „sub 10 documente”). Folosește intervalul listei.
- `src/lib/imagePreprocess.js` — înainte de blur check și upload (office + șofer): EXIF orientation „baked”, downscale la max 2600 px latura lungă, contrast stretch p1–p99 doar când intervalul luma < 150, re-encode JPEG 0.88. Skip sub 1,2 MB și în limită; dacă rezultatul e mai mare, pleacă originalul. Buget 8 s pe lot, un decode blocat nu ține upload-ul. **Niciodată nu blochează.**
- Șofer: pregătirea rulează înainte de verificarea de 15 MB, ca o poză full-res să nu fie refuzată pentru mărime.

## Teste

- `ocrBlocks.test.js` (server + client), `feedback.test.js`, `imagePreprocess.test.js`, `normalizeOcrText.test.js` (+8 pe sanitize).
- `readText.test.js` — `ocrCapability` nu mai depinde de `server/.env` (re-importul rula dotenv și punea cheia înapoi).

## Build 71 / v1.12.1 (retuș)

- `AvizBlockOverlay`: conturul blocurilor neutre („toate blocurile”) era aproape invizibil pe o foaie albă — `border-slate-600/70` + voal `bg-white/10`. Verificat în browser pe un aviz real: cu blocurile noi (dimensiuni pagină 1080×1920 de la Mistral) caseta TPO cade exact pe linia scrisă; geometria vine din `containedRect` (dreptunghiul `object-contain`), nu din CSS.

## Ce NU face

- Nu retrenează nimic și nu mută praguri singur: sugestiile se citesc de un om și se aplică în cod (`avizFieldSchema.js`, profiluri), ca o lună veche să fie recalculabilă identic.
- Overlay-ul nu desenează pe PDF și doar pe pagina 0.
