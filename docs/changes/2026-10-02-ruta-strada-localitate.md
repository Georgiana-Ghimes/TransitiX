# Rută: doar stradă + localitate (Expeditor / Adresa de livrare)

`ruta_transport` se construiește exclusiv din cele două blocuri etichetate:

- **Expeditor** → `Str. X, Localitate`
- **Adresa de livrare** → `Str. Y, Localitate`

Format: `Str. Republicii, Bolintin-Deal / Șosea Viilor, Bucuresti`

Nu mai intră: număr stradal (`nr.`), coduri site (`BOL`, `CS-…`, `AP-…`), Client factură, `PAGINA`.

## Baumit două coloane (tab OCR)

PDF-ul pune Adresa de livrare | Client pe același rând. `pdf-parse` emite celule pe tab;
clip-ul la `C########` tăia strada de livrare. Soluție: păstrăm newlines/tab-uri pentru
adrese (nu blob-ul lipit cu spații) și reconstruim coloana stângă înainte de parse.
