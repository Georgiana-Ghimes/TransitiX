# #80 — Expeditor lipsă din rută

## Problemă

`IMG-20261002-WA0046.jpg` (PSL-0062317): ruta era doar `Str. Liviu Rebreanu nr. 13, București`, fără `Str. Industriei nr. 7, Bolintin-Deal`.

## Cauză

Fără „Baumit” în textul OCR, documentul cădea pe `aviz_generic`, al cărui `routeField` nu folosea `parseBaumitAviz` (Expeditor → Adresa de livrare).

## Fix

- `routeField` încearcă mai întâi parse-ul Baumit (două picioare)
- Scor PSL-/TRO- ridicat la detectProfile
- Fallback: strada de deasupra „Adresa de livrare” dacă lipsește eticheta „Expeditor”
