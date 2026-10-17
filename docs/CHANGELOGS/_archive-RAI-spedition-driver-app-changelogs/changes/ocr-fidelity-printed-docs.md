# OCR fidelity (printed docs) + ticket 35 route

## Ce simțea operatorul

Paddle părea „mai slab” decât cu câteva build-uri în urmă pe avize tipărite / scanuri. Optimizările pentru **scris de mână** (autocontrast + sharpen pe fiecare pagină) rulau și pe documente curate și stricau recunoașterea.

Ticket 35 (`Bolintin-Deal` în loc de Dobroești) era un simptom separat: matcher de rută pe cratimă lipită, nu „Paddle nu a citit adresa”.

## Ce s-a schimbat (general, nu caz special)

1. **Sidecar Paddle:** orientarea se citește pe **imaginea raw**; enhance / upscale / umbră / CLAHE doar dacă lipsesc TPO/PSL sau plăcuța.
2. **PDF scan:** DPI implicit **280** (era 200).
3. **Extracție rută:** Site → Adresa de livrare; repair înlocuiește rute „false” (localitate cu cratimă, fără slash) din `raw_text`.

După deploy: **repornește containerul `paddle-ocr`** ca să încarce `app.py` nou.

## Poze carnet goale (follow-up)

Bug: `missing_from_text("")` era **False** sub 24 caractere → pe o poză unde raw OCR e gol, **nu** mai rula niciun pass (enhance/upscale/umbră). Poza de carnet pe fundal verde rămânea fără text.

Fix: gol / text scurt → tot încearcă pass-urile foto; plus pas `emphasize_ink` (cerneală albastră pe hârtie cu cast verde).
