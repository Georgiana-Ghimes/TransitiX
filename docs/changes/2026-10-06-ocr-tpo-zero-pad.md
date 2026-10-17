#55 TPO scris de mână fără zerouri (TPO/32755 → TPO-0032755)

Handwritten short TPOs were stored as `TPO-32755` and only marked low-confidence
(orange). Product expects the same 7-digit form as printed avize.

`normalizeTpo` now left-pads 4–5 digit bodies to 7 digits. Six-digit values stay
short + review (likely truncated OCR). Compound forms (`TPO-2026-0311`) unchanged.
