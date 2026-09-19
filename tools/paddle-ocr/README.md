# Local PaddleOCR for Transitix

Sidecar HTTP service used by the Node API for photo / scanned-PDF OCR when
`OCR_PROVIDER=paddle` (see `server/.env`).

## Why Docker?

This machine may only have Python 3.14 and no NVIDIA GPU. PaddleOCR needs
Python ≤3.12 and (optionally) CUDA. The Docker image uses **Python 3.10 + CPU**.

## Start

From the repo root:

```bash
docker compose -f docker-compose.paddle-ocr.yml up -d --build
```

First build downloads wheels + models (several minutes). Then:

- Health: http://127.0.0.1:8100/health  
- OCR: `POST /ocr` (multipart `file`) or `POST /ocr/json` (`{ "image_base64": "..." }`)

## Wire Transitix

In `server/.env`:

```env
OCR_PROVIDER=paddle
PADDLE_OCR_URL=http://127.0.0.1:8100
# Optional fallback if paddle is down:
```

Restart the API (`npm run dev` in `server/`). Upload an aviz photo from the
driver app or Avize page — `readDocumentText` will call Paddle for images.

## Language

Default `PADDLE_OCR_LANG=latin` covers Romanian diacritics reasonably. For
Chinese docs use `ch`. Set via compose env or `.env`.

## Auto-rotate

By default the service tries page orientations `0 → 90 → 270 → 180` when the
first pass scores poorly (missing TPO/PSL/keywords). Disable with
`PADDLE_OCR_AUTO_ROTATE=0`. Response includes `rotation` (degrees clockwise).

## Phone photos (perspective)

Single-page uploads (driver phone shots) run OpenCV page detection first and
warp the notebook to a frontal rectangle before ink/OCR. Full-bleed scans are
left alone. Disable with `PADDLE_OCR_PERSPECTIVE=0`.

Transitix Node also post-corrects codes/plates (`PS-…` → `PSL-…`, `B330SRS` →
`B 330 SRS`) in `server/src/lib/ocr/normalizeOcrText.js`.

## Handwriting (carnet de bord)

Handwritten notes are the hardest input this service gets, and two things decide
whether anything comes back at all.

**Detector input size.** PaddleOCR resizes a page so its longest side is at most
`det_limit_side_len` — **960** by default — before detection runs. A carnet line
is ~23 px tall in a 1024 px photo and ~120 px in a 4000 px one; both end up near
22 px after that cap, which is below what DB needs to close a box around a thin
ballpoint stroke. That cap is why upscaling in the preprocessing passes did
nothing for years: the pixels were thrown away one call later.
`PADDLE_OCR_DET_SIDE_LEN` (default **1920**) raises it, and every preprocessing
pass now resizes to exactly that, once, with a good resample. CPU cost grows
roughly with the square of this number — it is the first knob to turn down on a
slow VM.

**Ink extraction.** `emphasize_ink` white-balances the frame (gray-world) and
divides lightness by its own heavy blur, so each pixel is judged against the
paper immediately around it. A hand's shadow over half the sheet stops
mattering, and no global threshold has to be right for both halves. On
`sample-carnet.jpg` this separates ink from paper by 138 gray levels at 6% ink
coverage, against 84 levels at 31% for the old `min(R, G)` — which assumed the
paper was brighter in red than the ink, and under a green monitor cast there is
barely any red light to be bright in.

### The scan pass (`scan_like_document`)

Runs the treatment a phone scanner app applies, in the order that matters:

1. White-balance and divide out the lighting (`emphasize_ink`), so nothing
   downstream is reading a shadow.
2. **Deskew off the notebook's own ruled lines.** They are a better baseline
   reference than the writing: there are more of them and they are straight. On
   `sample-carnet.jpg` this finds −4.0° from 86 Hough segments. Connected
   components cannot do this — handwriting crosses every rule and breaks it into
   pieces (3 components where there are 18 lines).
3. Adaptive binarize.
4. **Erase the rules, keep the letters crossing them.** A rule pixel with ink
   running vertically through it belongs to a character, not the rule. Without
   that test a horizontal open takes the writing along with the line.
5. Drop specks and blobs, sized against the median component.

It deliberately **does not crop to the page**. Two content-detection heuristics
were tried and both failed on the sample: quad detection finds nothing (the page
runs out of frame, so no closed contour) and a saturation mask cut the digits off
the right-hand side, because the lit half of the sheet is as green as the monitor
behind it. Background left in costs one wasted detection box; a wrong crop costs
the number that ends up on an invoice — the same trade `correct_perspective`
already settled.

### What a clean image cannot fix

`drop_score` is the filter that turns "read badly" into "read nothing".
PaddleOCR discards any line it recognised below that confidence, and **0.35 is a
printed-text number** — handwriting comes back at 0.1–0.3 even when the
characters are right, so a whole carnet is deleted and the caller sees an empty
read rather than a poor one. The default here is now **0.10**. Filtering belongs
downstream, where it is per field against `corrected_fields` and a review queue,
not per line with no appeal.

If a photo returns *exactly nothing*, check that before touching preprocessing:

```bash
docker compose -f docker-compose.paddle-ocr.yml run --rm   -e PADDLE_OCR_DROP_SCORE=0 paddle-ocr python bench.py sample-carnet.jpg
```

Text appearing at 0 and nothing at 0.35 means detection works and the filter was
eating it. Nothing at either means detection is the problem.

### The ceiling

`PADDLE_OCR_LANG=latin` loads `latin_PP-OCRv3_mobile_rec`, a small model trained
on **printed** text. There is no handwriting recognition model for Latin script
in PaddleOCR. Preprocessing decides whether lines are *found*; what they are
*read as* is that model's ceiling, and block capitals in ballpoint sit outside
what it was trained on. Expect codes, plates, dates and numbers to come back
usable and prose (`RUTA TRANS`, `TIP MARFĂ`) to stay unreliable — which is what
the per-field confidence and the review queue are for.

### Measuring a change

`bench.py` runs every preprocessing variant through real OCR and prints what each
recovers, with timings.

```bash
docker compose -f docker-compose.paddle-ocr.yml run --rm   paddle-ocr python bench.py sample-carnet.jpg
```

Point it at a folder instead, which is the point — one photo proves nothing about
handwriting, and `sample-carnet.jpg` is a 576 px copy, far smaller than what a
driver's phone sends:

```bash
docker compose -f docker-compose.paddle-ocr.yml run --rm   -v /path/to/real/photos:/data paddle-ocr python bench.py /data
```

Expected tokens turn "looks better" into a number. Put them in a
`<photo>.expect.txt` beside each file (one per line, or comma-separated), or use
`BENCH_EXPECT=TPO-0025813,B-112-VFM,TRO-0008053` for the whole run. Matching
ignores spacing and punctuation but not a missing digit, so a truncated code
never counts as found — the same rule `CODE_DIGITS` enforces on the way in.

`--sweep=960,1440,1920,2560` re-runs everything at each detector size and rebuilds
the engine between rounds. Take the **smallest** size that finds the tokens: cost
grows with its square, and a person is waiting inside
`OCR_INTERACTIVE_TIMEOUT_MS` (120 s). 1920 is a starting guess made by measuring
stroke height, not throughput — the VM decides the rest.

A preprocessing change is worth keeping only if this output says so. Intuition
about what "should" help handwriting is wrong often enough that guessing costs
more than measuring: `min(R, G)` and the upscale passes both looked reasonable and
both made things worse.

## Stop

```bash
docker compose -f docker-compose.paddle-ocr.yml down
```

## Verificarea logicii, fără motorul OCR

`check_logic.py` rulează tot ce e în jurul recunoașterii — rasterizarea PDF, plafonul de pagini,
raportarea trunchierii, căutarea orientării — cu PaddleOCR înlocuit de un dublu. Așa se poate
verifica partea care decide *ce* se citește, pe o mașină fără sute de megaocteți de dependențe ML:

```bash
python tools/paddle-ocr/check_logic.py
```

În container, unde e deja totul instalat:

```bash
docker compose -f docker-compose.companion.yml exec paddle-ocr python /app/check_logic.py
```

Iese cu cod diferit de zero dacă vreo verificare pică. Nu atinge PaddleOCR — pentru asta trebuie
împins un aviz real prin `/avize`.
