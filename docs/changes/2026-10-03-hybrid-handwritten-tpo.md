# Hybrid OCR: TPO scris de mână pe aviz tipărit

Pe unele avize Baumit, „Num de comanda de transport” e gol pe tipar, iar șoferul scrie cu roșu `TPO / 31027`.

- `normalizeOcrText` / `normalizeTpo` / `TPO_CODE` acceptă separator `/` (și `:`)
- Extracție hibridă pe profilele aviz (`hybridAvizTpoField`): TPO tipărit, prefix mangled, sau notă lângă eticheta „comandă de transport”
- Codurile scurte (≠ 7 cifre) rămân prefilled + review, ca înainte

Nu e un al doilea motor OCR — același Mistral + profile.
