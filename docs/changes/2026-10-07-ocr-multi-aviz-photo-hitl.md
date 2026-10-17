# OCR #59: două avize în aceeași poză

Poza side-by-side producea un singur rând cu valori amestecate (plăcuțe, cantități).

- `detectMultipleAvizeInText`: ≥2 PSL/TRO sau ≥2 TPO pe `raw_text` → finding `multiple_avize_in_image` (error).
- Routing `hitl_required` = „Verificare obligatorie” + mesaj în Verifică.
- Separarea automată a JPEG-ului în două rânduri rămâne pe mai târziu.
