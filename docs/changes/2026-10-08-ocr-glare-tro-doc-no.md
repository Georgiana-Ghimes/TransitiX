# #75 — Număr document marfă gol sub reflexie (TRO)

## Problemă

`IMG-20261001-WA0043.jpg`: TRO-0010601 lizibil pe „Aviz de expediție” / „Comanda de transfer”, dar câmpul rămânea gol fără etichetă de verificare. Imaginea e luminoasă, cu glare pe zona numărului.

## Cauză

OCR sub glare citește adesea TRO ca TPO (`TPO-0010601`). Extracția de document acceptă doar PSL/TRO, iar TPO-ul din titlul rezumat (`TPO-0033508`) umple corect Număr TPO — deci restul câmpurilor arată bine, iar nr. document lipsea fără HITL (câmp non-critic).

## Fix

- Lângă etichetele de aviz/transfer: un cod TPO/IRO/TR0 ale cărui cifre **nu** sunt ale TPO-ului de comandă → `TRO-…`
- Normalize: IRO / TRQ → TRO
- Validare `doc_no_missing` (error → HITL) când eticheta există dar câmpul e gol

## Fișiere

- `server/src/lib/ocr/profiles.js`
- `server/src/lib/ocr/normalizeOcrText.js`
- `server/src/lib/ocr/validateAviz.js`
