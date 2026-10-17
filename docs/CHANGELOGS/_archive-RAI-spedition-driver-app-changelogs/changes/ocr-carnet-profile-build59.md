# Build 59 — Profil OCR carnet de bord

## Ce

Profil nou `carnet_bord` în `profiles.js`: vocabularul carnetului (TIP/CANT MARFĂ, NR. CURSE,
RUTA TRANS. pe 2 linii, DATA cu colon, TPO citit ca TP0/IPO).

`numar_curse` inclus în `EXTRACT_COLUMNS` ca să ajungă pe rândul documentului.

## Teste

`server/src/lib/ocr/extract.test.js` — detectare, câmpuri, cantitate `15,744,00`, fără unitate de pe linia următoare.
