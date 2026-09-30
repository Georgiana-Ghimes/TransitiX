"""
Exercises everything in `app.py` except PaddleOCR itself.

The recognition engine is heavy — hundreds of megabytes and a model download — so on a machine
without it the page handling around it used to go unrun and unverified. This replaces
`ocr_array` with a double and checks the parts that decide what gets read: PDF rasterisation,
the page cap, what the response says it read, and the orientation search that only happens once.

    pip install fastapi pydantic python-multipart pymupdf pillow numpy
    python tools/paddle-ocr/check_logic.py

Inside the built container everything is already present, so it runs as-is:

    docker compose -f docker-compose.companion.yml exec paddle-ocr python /app/check_logic.py
"""
from __future__ import annotations

import asyncio
import base64
import importlib.util
import io
import logging
import os
import sys

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
logging.disable(logging.INFO)

spec = importlib.util.spec_from_file_location("paddle_app", os.path.join(HERE, "app.py"))
app_module = importlib.util.module_from_spec(spec)
# pydantic resolves `from __future__ import annotations` against the module in sys.modules.
# Loading by path without this makes the request models look "not fully defined".
sys.modules["paddle_app"] = app_module
spec.loader.exec_module(app_module)

failures: list[str] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    print(("  PASS  " if passed else "  FAIL  ") + name + (f"   {detail}" if detail else ""))
    if not passed:
        failures.append(name)


def make_pdf(pages: int) -> bytes:
    """A portrait PDF with real text on every page."""
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_text((60, 80), f"AVIZ PSL-004436{i}  pagina {i + 1}", fontsize=18)
    data = doc.tobytes()
    doc.close()
    return data


calls: list[tuple[int, int]] = []


def stub_engine(reads_well_when_landscape: bool):
    """Stands in for PaddleOCR: readable text only in one orientation, so choices are visible."""
    def ocr_array(arr):
        height, width = arr.shape[0], arr.shape[1]
        calls.append((width, height))
        if (width > height) == reads_well_when_landscape:
            return "Aviz de expeditie PSL-0044362 greutate bruta 9964 kg transport", [0.95] * 12
        return "iiii", [0.2]
    return ocr_array


def main() -> int:
    print("import app.py: OK - nothing at import time needs paddle")

    app_module.ocr_array = stub_engine(False)

    pages, total = app_module.pages_from_bytes(make_pdf(3))
    check("a PDF is rasterised, one image per page", len(pages) == 3 and total == 3,
          f"pages={len(pages)} total={total}")
    check("the rasterised page is a usable image", pages[0].size[0] > 100, f"size={pages[0].size}")

    buf = io.BytesIO()
    pages[0].save(buf, format="PNG")
    single, single_total = app_module.pages_from_bytes(buf.getvalue())
    check("an image is one page and is not sent through fitz",
          len(single) == 1 and single_total == 1)

    capped, real_total = app_module.pages_from_bytes(make_pdf(6), max_pages=2)
    check("the cap limits how many pages are read", len(capped) == 2)
    # A partial read filed as the whole document understates a figure on an invoice.
    check("the true page count survives the cap", real_total == 6, f"total={real_total}")

    text, _rotation, read, total = app_module.run_ocr_on_bytes(make_pdf(6), max_pages=2)
    check("run_ocr_on_bytes returns (text, rotation, read, total)", (read, total) == (2, 6),
          f"read={read} total={total}")
    check("text from every page read is joined", text.count("PSL") >= 2, repr(text[:50]))

    # Orientation: page one searches, the rest reuse what won. Counted per page, because the
    # flat call list cannot say where one page ended and the next began.
    calls.clear()
    app_module.ocr_array = stub_engine(True)
    per_page: list[int] = []
    real_ocr_page = app_module.ocr_page

    def counting_ocr_page(image, prefer=None, extra_passes=False):
        before = len(calls)
        result = real_ocr_page(image, prefer=prefer, extra_passes=extra_passes)
        per_page.append(len(calls) - before)
        return result

    app_module.ocr_page = counting_ocr_page
    try:
        _text, rotation, _read, _total = app_module.run_ocr_on_bytes(make_pdf(3))
    finally:
        app_module.ocr_page = real_ocr_page

    check("the first page searches orientations", per_page[0] > 1, f"{per_page[0]} passes")
    check("later pages cost one pass each, not four",
          all(n == 1 for n in per_page[1:]), f"passes per page: {per_page}")
    check("the winning rotation is reported", rotation in (90, 270), f"rotation={rotation}")

    app_module.ocr_array = stub_engine(False)
    truncated = asyncio.run(app_module.ocr_json(app_module.OcrJsonRequest(
        image_base64=base64.b64encode(make_pdf(6)).decode(),
        mime_type="application/pdf",
        max_pages=2,
    )))
    check("the response says it read only part of the document",
          (truncated.pages, truncated.total_pages, truncated.truncated) == (2, 6, True),
          f"pages={truncated.pages} total={truncated.total_pages} truncated={truncated.truncated}")

    whole = asyncio.run(app_module.ocr_json(app_module.OcrJsonRequest(
        image_base64=base64.b64encode(make_pdf(2)).decode(),
        mime_type="application/pdf",
    )))
    check("nothing is flagged truncated when everything was read",
          whole.truncated is False and whole.total_pages == 2)

    # Re-rendering passes are for phone photos, and must not multiply the cost of a dossier.
    from PIL import Image as PILImage
    tiny = PILImage.new("RGB", (400, 600), (180, 180, 180))
    check("a small phone frame is upscaled for the second pass",
          app_module.upscale_for_ocr(tiny).size == (1200, 1800),
          f"size={app_module.upscale_for_ocr(tiny).size}")
    check("an already large page is left at its own size",
          app_module.upscale_for_ocr(PILImage.new("RGB", (2400, 3000))).size == (2400, 3000))

    # Every photo pass must hand the detector exactly the size it will read at. Preprocessing
    # that enlarges past PADDLE_OCR_DET_SIDE_LEN is silently undone by Paddle's own resize —
    # that is how a handwritten carnet reached the detector at ~22px and returned nothing.
    side = app_module._DET_SIDE_LEN
    for name, source in (
        ("a small phone frame", PILImage.new("RGB", (576, 1024), (180, 180, 180))),
        ("a 12MP phone photo", PILImage.new("RGB", (3024, 4032), (180, 180, 180))),
    ):
        for pass_name, transform in (
            ("emphasize_ink", app_module.emphasize_ink),
            ("plain", app_module.fit_for_detector),
            ("shadow", app_module.flatten_shadow),
            ("clahe", app_module.enhance_aggressive),
        ):
            size = transform(source).size
            check(f"{name} reaches the detector at its working size ({pass_name})",
                  max(size) == side, f"{source.size} -> {size}, expected long side {side}")

    check("the detector cap is above PaddleOCR's own 960 default",
          side > 960, f"PADDLE_OCR_DET_SIDE_LEN={side}")

    # Ink emphasis must survive an illuminant it was not tuned for. A frame lit green (monitor)
    # has almost no red channel to work with, which is what min(R, G) got wrong.
    import numpy as _np
    lit = _np.dstack([
        _np.full((200, 300), 60, "uint8"),    # R starved
        _np.full((200, 300), 210, "uint8"),   # G from the screen
        _np.full((200, 300), 180, "uint8"),
    ]).copy()
    lit[80:120, 40:260] = 30  # a dark stroke
    inked = _np.asarray(app_module.emphasize_ink(PILImage.fromarray(lit)).convert("L"))
    check("ink emphasis leaves paper bright under a green cast",
          inked.mean() > 120, f"mean={inked.mean():.1f}")

    # The scan pass: deskew off the ruled lines, erase them, keep the letters crossing them.
    import cv2 as _cv2

    ruled = _np.full((900, 700), 240, "uint8")
    for y in range(120, 860, 48):                      # the notebook's rules
        _cv2.line(ruled, (40, y), (660, y), 120, 2)
    for x in range(90, 600, 60):                       # writing that crosses them
        _cv2.line(ruled, (x, 150), (x + 8, 210), 40, 5)
    tilted = app_module.rotate_gray(ruled, 4.0)        # as if photographed askew
    page = PILImage.fromarray(_cv2.cvtColor(tilted, _cv2.COLOR_GRAY2RGB))

    segments = app_module.rule_segments(app_module._ink_mask(tilted))
    check("ruled lines are found as Hough segments", len(segments) >= 5,
          f"{len(segments)} segments")

    angles = [_np.degrees(_np.arctan2(float(y2 - y1), float(x2 - x1)))
              for x1, y1, x2, y2 in segments] if segments else [0.0]
    check("the skew angle is recovered from the rules",
          abs(abs(float(_np.median(angles))) - 4.0) < 1.5,
          f"found {float(_np.median(angles)):.2f}deg, planted 4.0deg counter-clockwise")

    scanned = app_module.scan_like_document(page)
    check("the scan pass returns ink on white paper at detector size",
          max(scanned.size) == app_module._DET_SIDE_LEN and scanned.mode == "RGB",
          f"{scanned.size} {scanned.mode}")

    scan_ink = (_np.asarray(scanned.convert("L")) < 128).mean()
    check("de-ruling does not erase the writing with the lines",
          0.0005 < scan_ink < 0.30, f"ink={scan_ink:.4f}")

    # Unruled paper is the common case (a printed aviz) and must survive untouched-ish.
    blank = _np.full((1200, 900), 235, "uint8")
    blank[300:340, 100:700] = 40
    kept = app_module.scan_like_document(
        PILImage.fromarray(_cv2.cvtColor(blank, _cv2.COLOR_GRAY2RGB)))
    check("a page with no rules still comes back with its text",
          (_np.asarray(kept.convert("L")) < 128).mean() > 0.0001,
          f"ink={(_np.asarray(kept.convert('L')) < 128).mean():.5f}")

    check("the line filter is below what handwriting scores",
          float(os.environ.get("PADDLE_OCR_DROP_SCORE", "0.10") or 0.10) <= 0.15,
          "handwriting recognises at 0.1-0.3; 0.35 deletes the whole page")
    check("short garbage does not trigger a second OCR pass",
          app_module.needs_aggressive_pass("iiii") is False)
    check("longer text without a code does trigger it",
          app_module.needs_aggressive_pass("x" * 40) is True)
    check("text that already has TPO skips the second pass",
          app_module.needs_aggressive_pass("Aviz TPO-0025813 livrare") is False)
    check("a page missing only the plate still asks for another pass",
          app_module.missing_from_text("Aviz de expeditie TPO-0025813 catre depozit") is True)
    check("a page with both a code and a plate is done",
          app_module.missing_from_text("Aviz TPO-0025813 auto B 330 SRS livrare") is False)
    check("empty OCR still asks for photo passes (notebook under glare)",
          app_module.missing_from_text("") is True)
    check("short junk still asks for photo passes",
          app_module.missing_from_text("iiii") is True)

    # Perspective: a white page on a dark desk must warp; a full-bleed sheet must not invent corners.
    # OpenCV is in the Docker image; a bare host may only have pillow/numpy — skip, don't fail.
    try:
        import cv2
        import numpy as np
        from PIL import Image as PILImageCheck
        has_cv2 = True
    except ImportError:
        has_cv2 = False

    if has_cv2:
        desk = np.full((800, 600, 3), 30, dtype=np.uint8)
        # Trapezoid page (phone-oblique): wider at the bottom.
        page_pts = np.array([[120, 80], [480, 100], [540, 720], [60, 700]], dtype=np.int32)
        cv2.fillConvexPoly(desk, page_pts, (230, 225, 210))
        warped = app_module.correct_perspective(PILImageCheck.fromarray(desk))
        check("oblique page photo is perspective-warped",
              warped.size != (600, 800) and warped.size[0] > 200 and warped.size[1] > 200,
              f"size={warped.size}")
        ordered = app_module.order_quad_points(page_pts.astype("float32"))
        check("quad corners are ordered TL-TR-BR-BL",
              ordered[0][1] < ordered[3][1] and ordered[0][0] < ordered[1][0],
              f"ordered={ordered.tolist()}")
        full = PILImageCheck.new("RGB", (600, 800), (240, 240, 240))
        same = app_module.correct_perspective(full)
        check("full-bleed page is left alone (no false warp)",
              same.size == (600, 800), f"size={same.size}")
    else:
        print("  SKIP  perspective checks (opencv not installed on host)")

    # The photo path re-renders; the dossier path must stay at one pass per page after the first.
    calls.clear()
    photo = io.BytesIO()
    PILImage.new("RGB", (900, 1200), (200, 200, 200)).save(photo, format="PNG")
    app_module.ocr_array = stub_engine(False)
    app_module.run_ocr_on_bytes(photo.getvalue())
    photo_passes = len(calls)
    # The first orientation already reads, so anything past one call is a re-render looking for
    # the field the flat pass missed — here the plate.
    check("a single photo gets the extra rendering passes", photo_passes > 1,
          f"{photo_passes} passes")

    calls.clear()
    app_module.run_ocr_on_bytes(make_pdf(3))
    check("a multi-page scan does not pay for them on every page", len(calls) <= 8,
          f"{len(calls)} passes for 3 pages")

    # A CMR has no TPO code. Page one still searches, but pages that read confidently at the
    # first page's angle must not pay three more full passes each.
    def cmr_engine(arr):
        height, width = arr.shape[0], arr.shape[1]
        calls.append((width, height))
        if height >= width:
            return "Scrisoare de trasura internationala CMR marfa livrata", [0.93] * 6
        return "iiii", [0.2]

    calls.clear()
    per_page.clear()
    app_module.ocr_array = cmr_engine
    app_module.ocr_page = counting_ocr_page
    try:
        app_module.run_ocr_on_bytes(make_pdf(3))
    finally:
        app_module.ocr_page = real_ocr_page
    check("pages without a code reuse the first page's angle when they read confidently",
          per_page[1:] == [1, 1], f"passes per page: {per_page}")

    # Budget: the sidecar stops when Node has given up, instead of computing for nobody.
    import time as _time
    from fastapi import HTTPException as _HTTPException

    def slow_engine(arr):
        _time.sleep(0.02)
        app_module.check_deadline()
        return "iiii", [0.2]

    app_module.ocr_array = slow_engine
    try:
        app_module.run_ocr_budgeted(photo.getvalue(), None, 5)
        stopped = None
    except _HTTPException as exc:
        stopped = exc.status_code
    check("OCR stops at the caller's deadline (504)", stopped == 504, f"status={stopped}")
    check("the lock is released after a stopped job", not app_module._OCR_LOCK.locked())

    app_module._OCR_LOCK.acquire()
    try:
        check("/health answers and says busy while a job runs", app_module.health()["busy"] is True)
        try:
            app_module.run_ocr_budgeted(photo.getvalue(), None, 50)
            queued = None
        except _HTTPException as exc:
            queued = exc.status_code
        check("a job whose budget runs out in the queue never starts (503)", queued == 503,
              f"status={queued}")
    finally:
        app_module._OCR_LOCK.release()

    # Rows rebuilt from the boxes. Paddle returns one box per detected run of text, so a label
    # and the figure printed beside it are two boxes; joined in arrival order they land on two
    # lines and every "label then number on the same line" pattern downstream finds nothing.
    def quad(x1, y1, x2, y2):
        return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]

    paddle2x = [[
        [quad(60, 100, 200, 120), ("Greutate bruta:", 0.97)],
        [quad(300, 100, 380, 120), ("9.487,80", 0.96)],
        [quad(390, 100, 420, 120), ("kg", 0.95)],
        [quad(60, 140, 200, 160), ("Greutate neta:", 0.97)],
        [quad(300, 140, 380, 160), ("9.450,00", 0.96)],
    ]]
    entries = app_module.entries_from_result(paddle2x)
    check("paddle 2.x boxes are read with their text and score",
          len(entries) == 5 and entries[0]["score"] == 0.97,
          f"{len(entries)} entries")

    text, confs = app_module.lines_and_conf_from_result(paddle2x)
    # The unit sits right against its figure, so it joins with a space rather than a tab —
    # which is the form `matchLabelledWeight` reads as "number then unit".
    check("a label and the figure beside it end up on one line",
          text.split("\n")[0] == "Greutate bruta:\t9.487,80 kg",
          repr(text.split("\n")[0]))
    check("a second printed row stays a second line",
          text.split("\n")[1] == "Greutate neta:\t9.450,00", repr(text))
    check("every confidence survives the rebuild", len(confs) == 5, f"{len(confs)} scores")

    # 3.x hands back parallel lists in a dict, with rectangles rather than polygons.
    paddle3x = [{
        "rec_texts": ["Nr. auto", "B 330 SRS"],
        "rec_scores": [0.94, 0.91],
        "rec_boxes": [[60, 100, 140, 120], [300, 100, 400, 120]],
    }]
    text3, confs3 = app_module.lines_and_conf_from_result(paddle3x)
    check("paddle 3.x dict + rectangles rebuild the same way",
          text3 == "Nr. auto\tB 330 SRS" and len(confs3) == 2, repr(text3))

    check("a rectangle and a polygon describe the same cell",
          app_module.box_metrics([60, 100, 140, 120])
          == app_module.box_metrics(quad(60, 100, 140, 120)),
          f"{app_module.box_metrics([60, 100, 140, 120])}")

    # Words of one phrase must not be split by a tab, or `Nr. auto` stops matching its label.
    close = [[
        [quad(60, 100, 100, 112), ("Greutate", 0.9)],
        [quad(104, 100, 150, 112), ("bruta:", 0.9)],
        [quad(300, 100, 360, 112), ("9450", 0.9)],
    ]]
    close_text, _ = app_module.lines_and_conf_from_result(close)
    check("words of one phrase are joined by a space, columns by a tab",
          close_text == "Greutate bruta:\t9450", repr(close_text))

    # A box the caller could not measure must not take its text down with it.
    no_box = [[
        [quad(60, 100, 200, 120), ("cu caseta", 0.9)],
        [None, ("fara caseta", 0.9)],
    ]]
    loose_text, _ = app_module.lines_and_conf_from_result(no_box)
    check("text whose box is unusable is kept, not dropped",
          "fara caseta" in loose_text and "cu caseta" in loose_text, repr(loose_text))

    check("an empty result is still empty", app_module.lines_and_conf_from_result(None) == ("", []))

    # A photo is rarely square to the camera: boxes on one printed row differ by a few pixels.
    wobble = [[
        [quad(60, 100, 200, 120), ("Paleti:", 0.9)],
        [quad(300, 104, 340, 124), ("18", 0.9)],
    ]]
    wobble_text, _ = app_module.lines_and_conf_from_result(wobble)
    check("a few pixels of baseline wobble is still one row",
          wobble_text == "Paleti:\t18", repr(wobble_text))

    # EXIF orientation 6 = "rotate 90° clockwise to view"; the pixels are stored landscape.
    exif_photo = PILImage.new("RGB", (600, 400), (200, 200, 200))
    exif = exif_photo.getexif()
    exif[0x0112] = 6
    exif_buf = io.BytesIO()
    exif_photo.save(exif_buf, format="JPEG", exif=exif.tobytes())
    upright, _ = app_module.pages_from_bytes(exif_buf.getvalue())
    check("a phone photo is turned by its EXIF orientation before OCR",
          upright[0].size == (400, 600), f"size={upright[0].size}")

    print()
    if failures:
        print(f"FAILED: {len(failures)} - {', '.join(failures)}")
        return 1
    print("All checks passed (PaddleOCR itself is not exercised here).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
