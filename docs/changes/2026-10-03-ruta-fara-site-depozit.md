# Rută OCR: fără Site/Depozit ca origine; livrare completă

## Problemă
Pe avizul rezumat (Expeditor doar Site MIL + Depozit NEAMTIU), ruta devenea `MIL-NEAMTIU / Str. Republicii` — fără număr și localitate pe livrare.

## Cauze
1. `Referința client` era stop de secțiune; pe OCR real apărea după `Str. Republicii` și tăia `nr. 1F` + localitatea.
2. `protectUntil` trata orice stop dinaintea primei străzi ca pe heading companion — inclusiv `Adresa de livrare`, deci Expeditor înghițea strada de livrare pe OCR pe un singur rând.
3. Site/Depozit fără stradă nu trebuie să fie origină; valorile vechi `MIL-NEAMTIU / …` rămâneau blocate pentru că un ` / ` era considerat rută bună.

## Fix
- Nu mai oprim secțiunea de livrare la `Referința client` (doar scrub ca zgomot).
- `protectUntil` doar pentru companioni de pe același rând de heading.
- Origină doar dacă Expeditor are `streetName`; Site/Depozit singure → doar piciorul de livrare.
- `isSuspiciousRoute` marchează picioare tip Site-Depozit ca să le înlocuiască `repairAvizFromStored`.

Re-extrage avizul (sau redeschide lista — repair din raw_text) ca să vezi `Str. Republicii nr. 1F, Bolintin-Deal`.
