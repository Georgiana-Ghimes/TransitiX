# #84 Preview documente pe mobil (VM)

## Problemă

Pe mediul VM, preview-ul din Editează / Verificare OCR rămânea gol pe iOS (Safari); pe PROD părea ok. Cauza principală: după fix-ul #68, PDF-urile merg prin `blob:` în `<iframe>`, iar Safari lasă panoul gol. În plus, `/uploads` trimitea `X-Frame-Options: DENY`, deci nici URL-ul cu `?access_token=` nu putea fi încadrat same-origin.

## Remediere

- `/uploads`: `SAMEORIGIN` / `frame-ancestors 'self'` (restul API rămâne DENY)
- PDF verificat cu Bearer → preview pe URL cu token + `<embed type="application/pdf">` (nu blob în iframe)
- Imagini: în continuare blob (JWT nu stă în `src`)
- Fără gzip pe `/uploads`
- `resolvePreviewSource` + teste
