# Ștergere istoric exporturi

Pe **Rapoarte** și pe tab-ul **Sinteze** (Avize OCR):

- **Șterge** pe un rând — scoate un export din `aviz_export_log` (nu mai e re-descărcabil).
- **Șterge tot istoricul** — golește istoricul firmei, cu confirmare.

API: `DELETE /api/reports/exports/:id`, `DELETE /api/reports/exports`.
Retenția automată tot **nu** atinge tabela; ștergerea e doar manuală, la cererea operatorului. Avizele rămân neschimbate.
