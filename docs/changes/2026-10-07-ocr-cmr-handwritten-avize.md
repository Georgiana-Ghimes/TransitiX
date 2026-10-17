# OCR #66: CMR de mână pe /avize + greutate &lt; 100 kg

Scrisoare de trăsură (căsuțe 1–24) încărcată pe Avize era citită ca aviz/carnet: căsuța 12 → 12 kg, rută/tip/cantitate greșite, nr. document gol.

- Profil `aviz_cmr`: box 11 = greutate brută, box 7 = cantitate, serial CMR = nr. document marfă; net gol.
- `LOAD_WEIGHT_MIN_KG` (100) + finding `weight_implausible_low` — 12 kg nu mai trece ca greutate de încărcare.
