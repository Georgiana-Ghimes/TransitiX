# Google Vision on the VM (no secrets)

Text-layer PDFs stay the default aviz path. Vision is only for photos and text-poor PDFs (`avizVision.js`).

1. Create a Google Cloud Vision API key (restrict by IP if you can).
2. Put it in `server/.env` as `GOOGLE_VISION_API_KEY=` — never commit `.env` or the key.
3. Restart the API process (`npm run dev --prefix server` or the VM unit).
4. Upload a photo aviz: the list badge should read **Vision**. A PDF with a real text layer should stay **Text PDF**. If both text and Vision fail, the row is **Stub** for manual edit.

Leave the variable empty in local `.env` if you do not have a key; extracts still work on PDFs with a text layer.
