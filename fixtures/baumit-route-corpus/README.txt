Baumit route corpus
===================

Mirrors real Baumit aviz layout (Expeditor + Adresa de livrare|Client tabs +
transport block + footer Maniu). Includes golden path, CP edge cases, client
traps, and photo-like degraded PNGs.

Regenerate
  python3 fixtures/baumit-route-corpus/generate.py

Layout
  pdf/              synthetic Baumit PDFs
  png/              clean raster of the same content
  photo/real/       your real phone photos (copied in)
  photo/degraded/   tilt / stain / stamp / glare / blur variants
  manifest.json     expected locality / street / postcode / raw_text

Automated tests (no Mistral needed)
  npm test -- server/src/lib/ocr/baumitRouteCorpus.test.js

Manual smoke
  Upload pdf/* or photo/real/* or photo/degraded/* in companion Editează.
