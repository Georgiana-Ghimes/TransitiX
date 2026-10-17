# OCR #58: Număr TPO din „Nr. Reg. Com.” (0000/2000)

Când rândul TPO e greu de citit (ștampilă / rotație), un fallback `NNNN/YYYY` lua
`0000/2000` din subsolul Registrului Comerțului.

- Scos fallback-ul fără prefix TPO din `hybridAvizTpoField`.
- `canonicalTpoRaw` păstrează doar valori normalizate `TPO-…`.
- Repair / UI: orice non-TPO (inclusiv `0000/2000`) se golește și e marcat low.
