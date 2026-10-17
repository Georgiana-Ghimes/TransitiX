# Rută: nu mai rămâne doar „Șosea”

În OCR pe două coloane, tipul străzii (`Sosea` / `Str.`) putea rămâne singur în celula din
stânga, iar numele (`Viilor nr. 52`) era aruncat ca și cum ar fi fost coloana Client.

`leftColumnFromInterleaved` păstrează acum celula din dreapta când stânga e doar tipul
străzii. `formatAddressLine` nu mai emite un tip fără nume.

Avizele deja extrase: **Re-extrage** ca să recalculeze ruta.
