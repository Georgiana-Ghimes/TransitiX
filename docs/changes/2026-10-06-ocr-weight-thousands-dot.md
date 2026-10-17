#51 OCR greutate ×100 (separator mii → punct)

Printed `21,326.48` / `20,950.00` often comes back from photo OCR as `21.326.48`
(comma misread as dot). `parseNumber` in `server/src/lib/ocr/fields.js` treated any
`.NNN` as thousands and stripped *all* dots → `2132648`.

Fix: when several dots remain, last 1–2 digit group = decimal; earlier = thousands.
Same rule mirrored in order-import `parseNumber`.

Status badge (De revizuit vs Verificare obligatorie) is HITL confidence routing on
fields, not the `weight_implausible` zone-tax warning (> 60 t).
