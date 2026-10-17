# Ticket 35 — Ruta transport ≠ adresa de livrare

## Problemă

Exportul Excel putea scrie `Ruta transport = Bolintin-Deal` pentru un aviz a cărui **Adresă de livrare** e Dobroești (ex. TPO-0025629). Valoarea e orașul Expeditorului, nu livrarea.

## Cauză

Profilul OCR avea un matcher loose „City - City” care accepta cratimă **lipită** (`Bolintin-Deal` = compound place name). Câmpul rămânea ne-gol, iar `repairAvizFromStored` nu îl mai înlocuia cu ruta Site→livrare din textul OCR.

## Fix

1. Matcher-ul loose cere spații (sau săgeată / „către”) în jurul separatorului.
2. Profilele Baumit PSL/TRO folosesc `parseBaumitAviz` pentru rută (Site Bol/Mil + Adresă de livrare).
3. Repair: o rută „falsă” (ex. `Bolintin-Deal`) e înlocuită la listă/export din `raw_text`, fără re-extrage.
