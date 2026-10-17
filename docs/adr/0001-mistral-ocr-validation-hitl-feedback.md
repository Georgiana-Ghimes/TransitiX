# ADR 0001 — OCR pentru avize RAI: Mistral Document AI + validare + HITL + feedback

**Status:** acceptat · 2026-10-01 · companion v1.12.0 / build 70 · branch `MISTRAL-experimenting-rai-documents`

## Context

Companionul RAI citește avize de transport (tipărite și carnete de bord scrise de mână) și produce anexa de facturare. Până la build 66 citirea era locală (Paddle / Tesseract / VL sidecar), cu o calitate inegală pe scris de mână și cu o infrastructură (GPU, sidecar, modele) pe care nimeni nu o întreținea. Nu exista un strat care să spună *dacă* o valoare citită poate intra pe factură, nici o buclă care să arate ce corectează oamenii.

Ținta: aliniere la ce fac soluțiile enterprise de document AI — **Preprocesare → Extragere → Validare → Decizie → Învățare** — fără a lega aplicația de un singur vendor și fără „învățare” pe care nu o putem reproduce.

## Decizii

1. **Un singur provider OCR, cloud, înlocuibil.** Mistral Document AI (`OCR_PROVIDER=mistral|none`). Tot codul local OCR a fost șters, nu parcat. Granița cu providerul e în două funcții: `runMistralOcr` (text + blocuri) și `normalizePages` (forma blocurilor). Restul pipeline-ului nu știe de Mistral.
2. **Textul intră printr-o singură poartă.** `sanitizeOcrText` (NFC, control chars, ghilimele/liniuțe, rigle, spații) rulează înaintea oricărei corecții specifice documentelor; `normalizeOcrText` o apelează primul; `extractDocument` primește același text indiferent de sursă (OCR, pdf-parse, fixture). Vocabularul câmpurilor stă în profiluri, nu aici.
3. **Blocurile au o formă canonică.** `{page, type, text, confidence, bbox, page_width, page_height}` — ce vede UI-ul și ce stocăm în `extracted_data.ocr_blocks`. Un provider nou înseamnă un adaptor spre această formă, nu o schimbare în drawer.
4. **Validarea e a domeniului, nu a OCR-ului.** `validateAviz.js` știe ce e un TPO, o plăcuță, o dată plauzibilă, un duplicat la 90 de zile. Încrederea per câmp intră în benzi (`avizFieldSchema.js`): auto ≥ 0,92 / opțional ≥ 0,70, iar câmpurile critice (TPO, nr. auto, dată) la 0,95 / 0,80. Rutarea documentului e cea mai severă dintre câmpuri și reguli.
5. **Decizia e blocantă pentru critice.** `hitl_required` nu poate fi confirmat fără verificare (409 `NEEDS_REVIEW`); `force` doar admin, cu motiv, logat. Aprobarea e un eveniment propriu (`review_approved`), distinct de `corrected` și `confirmed`.
6. **Omul vede ce a văzut mașina.** Drawer-ul HITL pune scanul lângă câmpuri, desenează bbox-urile (câmp activ / citire nesigură), lasă operatorul să preia textul unui bloc cu un click. Pe PDF rămâne lista de probleme — iframe-ul nu se poate desena.
7. **„Învățarea” e un raport, nu un model.** Orice corecție — din drawer sau din formularul office — ajunge în `document_events` cu `field_changes[]` (old → new, cine, când). `GET /documents/feedback` agregă: câmpuri corectate, touch rate per bandă, reguli picate, sugestii — doar peste 10 documente. Pragurile și profilurile se schimbă **de un om, în cod**, ca o lună veche să se recalculeze identic. Nu există auto-tuning.
8. **Preprocesarea e în browser și e o curtoazie.** Orientare EXIF, downscale 2600 px, contrast doar când e spălat, JPEG. Nu blochează niciodată; un fișier care nu se poate pregăti pleacă așa cum e. Verificarea de blur rămâne avertisment.

## Consecințe

- (+) Calitate de citire mult mai bună pe scris de mână, zero infrastructură OCR locală, un singur loc de schimbat providerul.
- (+) O valoare critică greșită nu mai poate ajunge pe factură fără o privire umană; audit complet old → new.
- (+) Avem numerele ca să decidem dacă benzile sunt prea stricte sau prea laxe, pe interval, per câmp.
- (−) Dependență de un API extern cu cost per pagină și latență; health raportează `mistral-down`, iar OCR-ul picat nu blochează fluxul manual.
- (−) Pragurile sunt alese, nu calibrate: feedback-ul le va mișca în timp, dar prin commit, nu singur.
- (−) Overlay-ul nu acoperă PDF-uri și pagini > 0.

## Alternative respinse

- **Păstrarea OCR local „parcat”** — cod mort cu dependențe grele; șters.
- **Praguri unice pe document** — un TPO citit 0,85 e altceva decât un tip de marfă citit 0,85; benzile sunt pe câmp.
- **Auto-ajustarea pragurilor din feedback** — ar face un raport din martie nerecalculabil în aprilie.
- **Overlay pe PDF prin randare pdf.js** — cost și complexitate pentru un caz rar (avizele RAI sunt poze).
