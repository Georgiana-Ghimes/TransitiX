# OCR #70: Rută fără Produs / Cantitate / SKU

Pe avize tipărite, captura după „Adresa de livrare / Ruta” trecea în tabelul Produs|Cantitate|UM (ex. `… Produs Cantitate FinoGrande nr. 20`).

- Stop-uri pe headerul de marfă în secțiunea de livrare.
- `clipRouteGoodsTable` + scrub pe linia de adresă.
- Rută scurtă (ex. `BOL-DEAL / Str. Bucuresti`), fără SKU.
