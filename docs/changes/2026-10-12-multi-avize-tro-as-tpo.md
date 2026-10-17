# False „Mai multe avize” pe rezumat Baumit

**Simptom:** Aviz 24/28 din `07.10.2026.BAU.pdf` (deja split pe pagină) avea HITL `multiple_avize_in_image` cu `TPO-0010692, TPO-0033395`, deși pe pagină e un singur TPO.

**Cauză:** OCR citește `TRO-0010692` (Aviz de expediție / Comanda de transfer) ca `TPO-0010692`. Detectorul #59 vedea două TPO-uri.

**Fix:**
- `detectMultipleAvizeInText` ignoră „TPO” pe liniile de document marfă (nu pe `rezumat` / comandă de transport).
- `normalizeOcrText` repară aceleași contexte TRO←TPO pentru extracții viitoare.
- Re-validat rândul 24/28 în DB.
