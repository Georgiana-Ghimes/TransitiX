"""
Local PaddleOCR HTTP service for Transitix.

Transitix Node calls POST /ocr with an image, or with a scanned PDF it could not read.
Keep this process separate — heavy ML deps stay out of the Node API.

Quick wins baked in:
  - Page auto-rotation (0/90/180/270) scored by OCR confidence + RO doc keywords
  - Scanned PDFs rasterized here, so Node never needs an image toolchain
"""

from __future__ import annotations

import io
import logging
import os
import re
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("paddle-ocr")

app = FastAPI(title="Transitix PaddleOCR", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_engine = None

# Romanian / logistics hints — sideways photos often miss these until rotated.
_KEYWORD_RE = re.compile(
    r"(aviz|expedit|tpo|psl|tro|cmr|greutate|baumit|transport|placut|"
    r"adres|delegat|palet|comanda|livrare|auto|numar)",
    re.I,
)
_CODE_RE = re.compile(r"(?:TPO|TP0|TPQ|PSL|TRO)[\s\-._]*[0-9OIl]{3,}", re.I)
_PLATE_RE = re.compile(
    r"\b(?:B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|"
    r"HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)"
    r"\s?\d{2,3}\s?[A-Z]{3}\b",
    re.I,
)

# If first orientation already looks like an upright logistics doc, skip extra
# rotations (CPU). Require a real doc code — a plate alone is not enough (sideways
# handwriting often still reads B330SRS while mangling PSL → PS).
_GOOD_ENOUGH_SCORE = 12.0
# A scanned dossier runs to a dozen pages or more. The cap is a guard against a mis-sent
# archive, not an editorial decision — whatever it drops is reported back, never silently.
_PDF_MAX_PAGES = int(os.environ.get("PADDLE_OCR_PDF_PAGES", "40") or 40)
# 200dpi was fine for speed; small print on Baumit avize (street, postal code) needs more pixels.
_PDF_DPI = int(os.environ.get("PADDLE_OCR_PDF_DPI", "280") or 280)
_AUTO_ROTATE = os.environ.get("PADDLE_OCR_AUTO_ROTATE", "1").strip() not in ("0", "false", "False")
# Longest side the detector may see. PaddleOCR's own default is 960, which is below what a
# handwritten carnet needs (see get_engine). Costs CPU roughly with the square of this number,
# so it is the first knob to turn down if the VM cannot keep up.
_DET_SIDE_LEN = int(os.environ.get("PADDLE_OCR_DET_SIDE_LEN", "1920") or 1920)


def looks_upright_enough(text: str, score: float) -> bool:
    if score < _GOOD_ENOUGH_SCORE:
        return False
    return bool(_CODE_RE.search(text or ""))


def get_engine():
    """Lazy-load OCR so /health works before models finish downloading."""
    global _engine
    if _engine is not None:
        return _engine

    try:
        from paddleocr import PaddleOCR

        use_gpu = os.environ.get("PADDLE_OCR_USE_GPU", "0").strip() in ("1", "true", "True")
        lang = os.environ.get("PADDLE_OCR_LANG", "latin").strip() or "latin"
        log.info(
            "Loading PaddleOCR (lang=%s, gpu=%s, auto_rotate=%s, det_side=%s)",
            lang, use_gpu, _AUTO_ROTATE, _DET_SIDE_LEN,
        )

        # Detector geometry first, because it is what decided that handwriting was invisible:
        # PaddleOCR resizes the page so its LONG side is at most det_limit_side_len (960 by
        # default) before detection runs. A carnet line is ~23 px tall in a 1024 px photo and
        # ~120 px in a 4000 px one — both land near 25 px after that cap, which is under what DB
        # needs to close a box around a thin ballpoint stroke. Every upscale this file does was
        # being thrown away one call later.
        tuned = {
            "det_limit_side_len": _DET_SIDE_LEN,
            "det_limit_type": "max",
            # Faint ink: lower both the pixel map and the box gate (defaults 0.3 / 0.6).
            "det_db_thresh": float(os.environ.get("PADDLE_OCR_DET_PIXEL_THRESH", "0.2") or 0.2),
            "det_db_box_thresh": float(os.environ.get("PADDLE_OCR_DET_THRESH", "0.3") or 0.3),
            # Handwriting has ascenders and descenders a tight box clips; 1.5 is the printed default.
            "det_db_unclip_ratio": float(os.environ.get("PADDLE_OCR_UNCLIP", "2.0") or 2.0),
            # Thickens strokes on the probability map before boxing — built for thin text.
            "use_dilation": True,
            # PaddleOCR discards any line it recognised below this confidence. 0.35 is a
            # printed-text number: handwriting comes back at 0.1-0.3 even when the characters
            # are right, so that filter deletes a whole carnet and the caller sees an empty
            # read rather than a poor one. Filtering belongs downstream, where it is per field
            # against `corrected_fields` and a review queue, not per line with no appeal.
            "drop_score": float(os.environ.get("PADDLE_OCR_DROP_SCORE", "0.10") or 0.10),
        }
        base = {"use_angle_cls": True, "lang": lang, "use_gpu": use_gpu, "show_log": False}

        # Degrade one step at a time. The old two-step fallback dropped *all* tuning the moment
        # any single kwarg was unknown, so a version bump could silently restore printed-text
        # defaults and nobody would see it in the logs.
        for attempt, kwargs in (
            ("tuned", {**base, **tuned}),
            ("thresholds-only", {**base, "det_db_box_thresh": tuned["det_db_box_thresh"],
                                 "drop_score": tuned["drop_score"]}),
            ("base", base),
            ("minimal", {"lang": lang}),
        ):
            try:
                _engine = PaddleOCR(**kwargs)
                if attempt != "tuned":
                    log.warning("PaddleOCR rejected tuned args — running %s", attempt)
                return _engine
            except TypeError as exc:
                log.warning("PaddleOCR(%s) not accepted: %s", attempt, exc)
                continue
        raise RuntimeError("no accepted PaddleOCR constructor signature")
    except Exception as exc:  # noqa: BLE001
        log.exception("Failed to load PaddleOCR")
        raise RuntimeError(f"PaddleOCR unavailable: {exc}") from exc


def lines_and_conf_from_result(result) -> tuple[str, list[float]]:
    """Normalize paddleocr 2.x / 3.x result shapes into plain text + confidences."""
    if not result:
        return "", []

    lines: list[str] = []
    confs: list[float] = []

    if isinstance(result, list) and result and isinstance(result[0], list):
        page = result[0]
        for item in page or []:
            if not item:
                continue
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                text_part = item[1]
                if isinstance(text_part, (list, tuple)) and text_part:
                    lines.append(str(text_part[0]))
                    if len(text_part) > 1:
                        try:
                            confs.append(float(text_part[1]))
                        except (TypeError, ValueError):
                            pass
                elif isinstance(text_part, str):
                    lines.append(text_part)
        return "\n".join(lines).strip(), confs

    if isinstance(result, list):
        for item in result:
            if isinstance(item, dict):
                if "rec_texts" in item:
                    lines.extend(str(t) for t in item.get("rec_texts") or [])
                    for c in item.get("rec_scores") or []:
                        try:
                            confs.append(float(c))
                        except (TypeError, ValueError):
                            pass
                elif "text" in item:
                    lines.append(str(item["text"]))
    return "\n".join(lines).strip(), confs


def score_ocr(text: str, confidences: list[float], *, portrait_bonus: float = 0.0) -> float:
    """Higher = more likely upright logistics document."""
    blob = text or ""
    if not blob.strip():
        return -1.0

    avg_conf = sum(confidences) / len(confidences) if confidences else 0.35
    score = avg_conf * 10.0
    # Handwriting upside-down can look "confident" on a few short lines; reward volume.
    score += min(len(blob) / 50.0, 8.0)
    score += min(len(_KEYWORD_RE.findall(blob)), 8) * 1.5
    if _CODE_RE.search(blob):
        score += 6.0
    if _PLATE_RE.search(blob):
        score += 3.0
    # Phone photos of a notebook are almost always portrait; sideways pages get a small penalty.
    score += portrait_bonus
    return score


def ocr_array(arr) -> tuple[str, list[float]]:
    engine = get_engine()
    try:
        result = engine.ocr(arr, cls=True)
    except TypeError:
        result = engine.ocr(arr)
    return lines_and_conf_from_result(result)


def pages_from_bytes(data: bytes, max_pages: Optional[int] = None) -> tuple[list, int]:
    """
    One PIL image per page, plus how many pages the document actually has.

    A scanned PDF has no text layer, so Node hands the whole file over rather than trying to
    read it first. Rasterizing belongs here: the image toolchain is already installed for OCR,
    and keeping it out of the API is the reason this service exists.
    """
    from PIL import Image

    if data[:4] != b"%PDF":
        return [Image.open(io.BytesIO(data)).convert("RGB")], 1

    import fitz  # PyMuPDF

    cap = max_pages if max_pages and max_pages > 0 else _PDF_MAX_PAGES
    pages = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        total = doc.page_count
        for index, page in enumerate(doc):
            if index >= cap:
                break
            pix = page.get_pixmap(dpi=_PDF_DPI)
            pages.append(Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB"))
    if not pages:
        raise ValueError("PDF has no pages to read")
    return pages, total


_PERSPECTIVE = os.environ.get("PADDLE_OCR_PERSPECTIVE", "1").strip() not in ("0", "false", "False")


def order_quad_points(pts):
    """TL, TR, BR, BL — getPerspectiveTransform needs a stable corner order."""
    import numpy as np

    points = np.asarray(pts, dtype="float32").reshape(4, 2)
    ordered = np.zeros((4, 2), dtype="float32")
    sums = points.sum(axis=1)
    ordered[0] = points[np.argmin(sums)]  # top-left
    ordered[2] = points[np.argmax(sums)]  # bottom-right
    diffs = np.diff(points, axis=1).reshape(4)
    ordered[1] = points[np.argmin(diffs)]  # top-right
    ordered[3] = points[np.argmax(diffs)]  # bottom-left
    return ordered


def _quad_candidates_from_edges(edged, img_area: float):
    """Largest convex quads that look like a page, not a tiny sticker or the frame itself."""
    import cv2

    contours, _ = cv2.findContours(edged, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:12]
    found = []
    for contour in contours:
        peri = cv2.arcLength(contour, True)
        if peri < 40:
            continue
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        area = float(cv2.contourArea(approx))
        if area < 0.18 * img_area or area > 0.97 * img_area:
            continue
        found.append(approx.reshape(4, 2))
    return found


def find_page_quad(arr_rgb):
    """
    Best-effort page corners in a phone photo.

    Returns a 4×2 float32 array (unordered) or None when the sheet fills the frame /
    OpenCV is missing / no contour is page-like. A false warp is worse than no warp, so
    the area band is deliberate.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None

    h, w = arr_rgb.shape[:2]
    img_area = float(h * w)
    if img_area < 10_000:
        return None

    # Work on a modest copy — contour quality is fine at ~900px short side.
    scale = 1.0
    short = min(h, w)
    if short > 900:
        scale = 900.0 / float(short)
        work = cv2.resize(arr_rgb, (max(1, int(w * scale)), max(1, int(h * scale))))
    else:
        work = arr_rgb

    gray = cv2.cvtColor(work, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    edge_maps = [
        cv2.Canny(gray, 40, 140),
        cv2.Canny(gray, 20, 80),
    ]
    # Adaptive threshold helps cream paper under a green monitor cast (edges wash out).
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 7
    )
    edge_maps.append(cv2.bitwise_not(adaptive) if adaptive.mean() > 127 else adaptive)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    candidates = []
    for edged in edge_maps:
        closed = cv2.dilate(edged, kernel, iterations=2)
        closed = cv2.morphologyEx(closed, cv2.MORPH_CLOSE, kernel, iterations=2)
        candidates.extend(_quad_candidates_from_edges(closed, float(work.shape[0] * work.shape[1])))

    if not candidates:
        return None

    # Prefer the largest page-like quad (notebook usually dominates the shot).
    best = max(candidates, key=lambda q: float(cv2.contourArea(q.astype("float32"))))
    if scale != 1.0:
        best = best / scale
    return best.astype("float32")


def correct_perspective(image):
    """
    Warp a phone photo so the notebook page is frontal.

    No-op when the page cannot be found safely (full-bleed scans, busy backgrounds).
    Disable with PADDLE_OCR_PERSPECTIVE=0.
    """
    from PIL import Image
    import numpy as np

    if not _PERSPECTIVE:
        return image.convert("RGB")

    try:
        import cv2
    except ImportError:
        log.warning("opencv not installed — skipping perspective correction")
        return image.convert("RGB")

    frame = image.convert("RGB")
    arr = np.asarray(frame)
    quad = find_page_quad(arr)
    if quad is None:
        return frame

    rect = order_quad_points(quad)
    (tl, tr, br, bl) = rect
    width_a = float(np.linalg.norm(br - bl))
    width_b = float(np.linalg.norm(tr - tl))
    height_a = float(np.linalg.norm(tr - br))
    height_b = float(np.linalg.norm(tl - bl))
    max_w = int(max(width_a, width_b))
    max_h = int(max(height_a, height_b))
    if max_w < 120 or max_h < 160:
        return frame

    aspect = max_w / float(max_h)
    # Notebook / A4-ish; reject wild quads (desk corners, monitor bezels).
    if aspect < 0.35 or aspect > 2.8:
        log.info("perspective skipped — aspect %.2f out of band", aspect)
        return frame

    dst = np.array(
        [[0, 0], [max_w - 1, 0], [max_w - 1, max_h - 1], [0, max_h - 1]],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(arr, matrix, (max_w, max_h), flags=cv2.INTER_CUBIC)
    log.info("perspective corrected → %sx%s (was %sx%s)", max_w, max_h, frame.size[0], frame.size[1])
    return Image.fromarray(warped)


def enhance_for_ocr(image):
    """
    Light contrast lift for shadowed notebook photos.

    Does not binarize — handwriting OCR on CPU is brittle to hard thresholds.
    """
    from PIL import ImageEnhance, ImageOps

    frame = ImageOps.autocontrast(image, cutoff=1)
    frame = ImageEnhance.Contrast(frame).enhance(1.25)
    frame = ImageEnhance.Sharpness(frame).enhance(1.15)
    return frame


def upscale_for_ocr(image, target_short: int = 2000, cap: float = 3.0):
    """
    More pixels on thin ink.

    Measured on real driver photos: a plain 2x upscale is what recovers a handwritten plate
    (`B 33o SRS` at native size, `B330SRS` upscaled). Contrast tricks help less and sometimes
    cost the printed codes, so they belong in a later pass, not this one.
    """
    from PIL import Image

    frame = image.convert("RGB")
    w, h = frame.size
    short = min(w, h)
    if short >= target_short:
        return frame
    scale = min(cap, target_short / float(short))
    return frame.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)


def enhance_aggressive(image):
    """
    Upscale + CLAHE, for pages where more pixels alone were not enough.

    OpenCV stays optional so a slim install without cv2 still OCRs — it just degrades to plain
    upscaling.
    """
    from PIL import Image

    frame = fit_for_detector(image)
    try:
        import cv2
        import numpy as np
    except ImportError:
        log.warning("opencv not installed — skipping CLAHE pass")
        return frame

    arr = np.asarray(frame)
    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)
    channel_l, channel_a, channel_b = cv2.split(lab)
    channel_l = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(channel_l)
    merged = cv2.merge([channel_l, channel_a, channel_b])
    return Image.fromarray(cv2.cvtColor(merged, cv2.COLOR_LAB2RGB))


def fit_for_detector(image, side: Optional[int] = None):
    """
    Put the page at the size the detector actually reads, in one good resample.

    Paddle will resize to `det_limit_side_len` regardless; doing it here means a small photo is
    enlarged with LANCZOS instead of being enlarged by us and then shrunk by a cheap bilinear,
    and a 12 MP phone photo is reduced once with INTER_AREA rather than carried through every
    preprocessing pass at full size.
    """
    from PIL import Image

    target = int(side or _DET_SIDE_LEN)
    frame = image.convert("RGB")
    w, h = frame.size
    longest = max(w, h)
    if longest == target or longest <= 0:
        return frame
    scale = target / float(longest)
    size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    # LANCZOS sharpens thin strokes when enlarging; BOX averages cleanly when reducing.
    return frame.resize(size, Image.Resampling.LANCZOS if scale > 1 else Image.Resampling.BOX)


def gray_world(arr):
    """
    Neutralise the illuminant so ink extraction stops depending on the light in the cab.

    A driver's photo is lit by whatever is there — a green monitor, sodium street light, a phone
    torch. In this sample the monitor puts R=61 G=217 B=185 on the background while the shaded
    page sits at R=92 G=105 B=100, so a fixed channel choice is guessing.
    """
    import numpy as np

    values = arr.astype("float32")
    means = values.reshape(-1, 3).mean(axis=0)
    return np.clip(values * (means.mean() / np.maximum(means, 1e-3)), 0, 255).astype("uint8")


def emphasize_ink(image):
    """
    Ink on paper, independent of the light that fell on it.

    White-balance, then divide lightness by its own heavy blur. The division is what makes this
    illuminant-invariant: it measures each pixel against the paper immediately around it, so a
    hand's shadow over half the sheet stops mattering, and no global threshold has to be right
    for both halves.

    Replaces `min(R, G)`, which assumed the paper was brighter in red than the ink. Under a green
    cast there is barely any red light to be bright in, so on this sample it separated ink from
    paper by 84 gray levels while calling 31% of the frame ink — smearing shadow into the stroke
    class. This separates by 134 and calls 6% ink, which is about the real ink coverage of a
    nine-line note.
    """
    from PIL import Image
    import numpy as np

    frame = fit_for_detector(image)
    try:
        import cv2
    except ImportError:
        log.warning("opencv not installed — falling back to plain grayscale ink pass")
        return frame

    try:
        arr = np.asarray(frame)
        lightness = cv2.cvtColor(gray_world(arr), cv2.COLOR_RGB2LAB)[:, :, 0].astype("float32")
        # sigma scales with the page so the "background" stays paper, never a whole word.
        sigma = max(15.0, min(frame.size) / 45.0)
        background = cv2.GaussianBlur(lightness, (0, 0), sigmaX=sigma, sigmaY=sigma)
        flat = np.clip(lightness / np.maximum(background, 1e-3) * 200.0, 0, 255).astype("uint8")
        return Image.fromarray(flat).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        log.warning("ink emphasis failed: %s", exc)
        return frame


def _ink_mask(gray, block: int = 25, c: int = 10):
    """Ink as white-on-black, adaptively — no global threshold has to suit the whole sheet."""
    import cv2

    block = block if block % 2 else block + 1
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block, c
    )


def rule_segments(binary, min_fraction: float = 0.30):
    """
    The notebook's own ruled lines, as Hough segments.

    Connected components do not find them: handwriting crosses every rule and breaks it into
    pieces (3 components where there are 18 lines, measured). Hough does not care about breaks.
    Returns [] for unruled paper, which is the usual case for a printed aviz.
    """
    import cv2
    import numpy as np

    height, width = binary.shape[:2]
    lines = cv2.HoughLinesP(
        binary, 1, np.pi / 360, threshold=80,
        minLineLength=int(width * min_fraction), maxLineGap=12,
    )
    if lines is None:
        return []
    found = []
    for x1, y1, x2, y2 in lines[:, 0]:
        if abs(np.degrees(np.arctan2(float(y2 - y1), float(x2 - x1)))) < 30:
            found.append((int(x1), int(y1), int(x2), int(y2)))
    return found


def rotate_gray(gray, degrees: float):
    """Rotate about the centre, growing the canvas so nothing is cut off."""
    import cv2

    if abs(degrees) < 0.2:
        return gray
    height, width = gray.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), degrees, 1.0)
    cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
    new_w, new_h = int(height * sin + width * cos), int(height * cos + width * sin)
    matrix[0, 2] += new_w / 2 - width / 2
    matrix[1, 2] += new_h / 2 - height / 2
    return cv2.warpAffine(
        gray, matrix, (new_w, new_h),
        flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE,
    )


def strip_rules(binary, segments):
    """
    Erase the ruled lines and keep the letters crossing them.

    A rule pixel with ink extending vertically through it belongs to a character, not to the
    rule. That test is the whole trick — a plain horizontal morphological open takes the
    writing with the line, which is why de-ruling is usually skipped and the detector is left
    to box a word and its underline together.
    """
    import cv2
    import numpy as np

    if not segments:
        return binary, 0.0

    height, width = binary.shape[:2]
    rules = np.zeros_like(binary)
    for x1, y1, x2, y2 in segments:
        cv2.line(rules, (x1, y1), (x2, y2), 255, 3)

    vertical = cv2.morphologyEx(
        binary, cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(5, height // 120))),
    )
    protect = cv2.dilate(vertical, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 11)))
    erase = cv2.bitwise_and(rules, cv2.bitwise_not(protect))
    cleaned = cv2.bitwise_and(binary, cv2.bitwise_not(erase))
    return cleaned, float((erase > 0).mean())


def despeckle(binary):
    """
    Drop what is far too big or far too small to be a written character.

    Sized against the median component, so it adapts to the photo instead of carrying a pixel
    constant that is wrong at another resolution. Nothing is cropped — a blob left in costs one
    wasted detection box, while a wrong crop loses the digits, and this file already settled
    that trade once for the perspective warp.
    """
    import cv2
    import numpy as np

    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    if count < 2:
        return binary, 0.0
    height = binary.shape[0]
    heights = [stats[i, 3] for i in range(1, count) if 4 < stats[i, 3] < height // 6]
    median = float(np.median(heights)) if heights else 18.0

    out = binary.copy()
    for i in range(1, count):
        too_tall = stats[i, 3] > 4.5 * median
        too_small = stats[i, 4] < max(5, 0.02 * median * median)
        if too_tall or too_small:
            out[labels == i] = 0
    return out, median


def scan_like_document(image):
    """
    Make a phone photo look like a flatbed scan: flat lighting, straight lines, ink on white.

    This is the pipeline a scanner app runs, in the order that matters:

      1. White-balance and divide out the lighting (`emphasize_ink`), so the rest is not
         reading a shadow.
      2. Deskew off the notebook's own ruled lines. They are a better baseline reference than
         the text — there are more of them and they are perfectly straight. On the sample this
         finds -4.5 degrees from 65 segments.
      3. Adaptive binarize.
      4. Erase the rules, keeping the letters that cross them.
      5. Drop specks and blobs.

    Deliberately does NOT crop to the page. Every content-detection heuristic tried on the
    sample either found nothing (page runs out of frame, so no closed quad) or cut the digits
    off the right-hand side (the lit half of the sheet is as saturated as the monitor behind
    it). Leaving background in costs a wasted detection box; cropping it wrong costs the
    number that ends up on an invoice.

    Returns the frame unchanged when OpenCV is missing.
    """
    from PIL import Image
    import numpy as np

    try:
        import cv2
    except ImportError:
        log.warning("opencv not installed — skipping scan pass")
        return fit_for_detector(image)

    flat = np.asarray(emphasize_ink(image).convert("L"))

    segments = rule_segments(_ink_mask(flat))
    if segments:
        angles = [
            np.degrees(np.arctan2(float(y2 - y1), float(x2 - x1)))
            for x1, y1, x2, y2 in segments
        ]
        angle = float(np.median(angles))
        flat = rotate_gray(flat, angle)
        log.info("scan: deskew %.2f deg from %d ruled segments", angle, len(segments))
    else:
        angle = 0.0

    binary = _ink_mask(cv2.bilateralFilter(flat, 7, 60, 60), 41, 12)
    # Re-find on the straightened frame; the mask has to match the pixels being erased.
    binary, erased = strip_rules(binary, rule_segments(binary))
    binary, median = despeckle(binary)
    log.info(
        "scan: erased %.2f%% as rules, median glyph %.0fpx, ink %.1f%%",
        100 * erased, median, 100 * float((binary > 0).mean()),
    )

    # Back to dark ink on white paper, which is what the recognizer was trained on. Re-fit,
    # because deskewing grew the canvas past the detector's cap and Paddle would shrink it
    # again — the very thing this pipeline exists to stop.
    return fit_for_detector(Image.fromarray(255 - binary).convert("RGB"))


def flatten_shadow(image):
    """
    Divide the page by its own blur, which removes the hand / phone shadow a driver casts.

    Uneven light is the single most common defect in cab photos, and it defeats global contrast
    because half the sheet is correctly exposed.
    """
    from PIL import Image

    frame = fit_for_detector(image)
    try:
        import cv2
        import numpy as np
    except ImportError:
        return frame

    arr = np.asarray(frame.convert("L")).astype("float32")
    background = cv2.GaussianBlur(arr, (0, 0), sigmaX=25, sigmaY=25)
    normalised = np.clip(arr / np.maximum(background, 1e-3) * 200.0, 0, 255).astype("uint8")
    return Image.fromarray(normalised).convert("RGB")


def missing_from_text(text: str) -> bool:
    """
    Whether another pass is worth its CPU.

    Empty / near-empty means the raw pass failed — notebook photos with green monitor glare
    often return nothing until upscale + shadow flattening run. That used to be skipped because
    a short blob was treated as "not worth it", so a hard photo stayed blank forever.

    A printed aviz that already yielded both a logistics code and a plate stops here.
    """
    blob = (text or "").strip()
    if len(blob) < 24:
        return True
    return not (_CODE_RE.search(blob) and _PLATE_RE.search(blob))


def needs_aggressive_pass(text: str) -> bool:
    """
    Offline-check helper: content on the page but no logistics code.

    Unlike missing_from_text, short junk ("iiii") stays False — that gate is for deciding
    whether a second *kind* of pass is meaningful when some text already came back.
    """
    blob = (text or "").strip()
    if len(blob) < 24:
        return False
    return not bool(_CODE_RE.search(blob))


_AGGRESSIVE = os.environ.get("PADDLE_OCR_AGGRESSIVE", "1").strip() not in ("0", "false", "False")


def _score_frame(text: str, confs: list[float], frame) -> float:
    w, h = frame.size
    portrait_bonus = 1.5 if h >= w else -1.0
    return score_ocr(text, confs, portrait_bonus=portrait_bonus)


def _merge_ocr_text(best_text: str, best_score: float, text: str, score: float) -> tuple[str, float]:
    if not text:
        return best_text, best_score
    if score > best_score:
        return (f"{text}\n{best_text}".strip() if best_text else text), score
    if missing_from_text(best_text):
        return (f"{best_text}\n{text}".strip() if best_text else text), best_score
    return best_text, best_score


def ocr_photo_page(image) -> tuple[str, int, list[float], object | None]:
    """
    Phone photo of a notebook (or any single-page hard shot).

    Order of work:
      1. Perspective warp (page frontal) — oblique phone shots kill line detection.
      2. Ink-emphasised, upscaled frame per orientation — raw RGB under monitor glare
         often returns nothing and burns the interactive budget on empty reads.
      3. Extra enhance / shadow / CLAHE only while the best text is still thin.
    """
    import numpy as np

    try:
        base = correct_perspective(image)
    except Exception as exc:  # noqa: BLE001
        log.warning("perspective correction failed: %s", exc)
        base = image.convert("RGB") if hasattr(image, "convert") else image

    rotations = [0, 90, 270, 180] if _AUTO_ROTATE else [0]
    best_text = ""
    best_score = -1.0
    best_rot = 0
    best_confs: list[float] = []
    best_source = base

    for degrees in rotations:
        frame = base if degrees == 0 else base.rotate(-degrees, expand=True)
        prepared = emphasize_ink(frame)
        text, confs = ocr_array(np.array(prepared))
        score = _score_frame(text, confs, frame)
        log.info("OCR photo rotation=%s score=%.2f chars=%s (ink)", degrees, score, len(text))
        if score > best_score:
            best_score = score
            best_text = text
            best_rot = degrees
            best_confs = list(confs)
            best_source = frame
        # Phone notebooks are almost always upright; stop when TPO/PSL already reads.
        if degrees == rotations[0] and looks_upright_enough(text, score):
            break
        if looks_upright_enough(text, score) and degrees != 0:
            break

    if _AGGRESSIVE:
        passes = (
            # Deskew + de-rule + binarize: the scanner-app treatment, and the only pass that
            # addresses the ruled lines running through every word.
            ("scan", scan_like_document),
            # Untouched pixels at detector size: the ink map assumes ballpoint on paper, and a
            # printed aviz photographed in daylight does not need it.
            ("plain", fit_for_detector),
            ("shadow", flatten_shadow),
            ("clahe", enhance_aggressive),
            ("enhance", enhance_for_ocr),
        )
        for name, transform in passes:
            if not missing_from_text(best_text):
                break
            try:
                text, confs = ocr_array(np.array(transform(best_source)))
            except Exception as exc:  # noqa: BLE001
                log.warning("OCR photo pass %s failed: %s", name, exc)
                continue
            score = _score_frame(text, confs, best_source)
            log.info("OCR photo pass=%s score=%.2f chars=%s", name, score, len(text))
            prev = best_text
            best_text, best_score = _merge_ocr_text(best_text, best_score, text, score)
            if best_text != prev and score >= best_score:
                best_confs = list(confs)

    hybrid_meta = _maybe_hybrid(best_source, photo=True)
    if hybrid_meta is not None and hybrid_meta.text.strip():
        best_text = hybrid_meta.text
        best_confs = list(hybrid_meta.confidences)

    return best_text, best_rot, best_confs, hybrid_meta


def _maybe_hybrid(frame, *, photo: bool = False):
    """Run PATH-B hybrid when HYBRID_OCR=1. `photo` applies ink emphasize first."""
    if os.environ.get("HYBRID_OCR", "1").strip() in ("0", "false", "False"):
        return None
    import numpy as np

    try:
        from pipeline import ocr_hybrid

        if hasattr(frame, "convert"):
            rgb = emphasize_ink(frame) if photo else frame.convert("RGB")
            arr = np.array(rgb)
        else:
            arr = np.asarray(frame)
        return ocr_hybrid(get_engine(), arr)
    except Exception as exc:  # noqa: BLE001
        log.warning("hybrid OCR failed: %s", exc)
        return None


def ocr_printed_page(
    image, prefer: Optional[int] = None
) -> tuple[str, int, list[float], object | None]:
    """Scanned / printed pages: raw pixels first, no phone-photo preprocess."""
    import numpy as np

    rotations = [0, 90, 270, 180] if _AUTO_ROTATE else [0]
    if prefer is not None and prefer in rotations:
        rotations = [prefer] + [d for d in rotations if d != prefer]
    best_text = ""
    best_score = -1.0
    best_rot = 0
    best_confs: list[float] = []
    best_frame = image.convert("RGB") if hasattr(image, "convert") else image

    for degrees in rotations:
        frame = image if degrees == 0 else image.rotate(-degrees, expand=True)
        rgb = frame.convert("RGB")
        text, confs = ocr_array(np.array(rgb))
        score = _score_frame(text, confs, frame)
        log.info("OCR rotation=%s score=%.2f chars=%s (raw)", degrees, score, len(text))
        if score > best_score:
            best_score = score
            best_text = text
            best_rot = degrees
            best_confs = list(confs)
            best_frame = rgb
        if degrees == rotations[0] and looks_upright_enough(text, score):
            break

    hybrid_meta = _maybe_hybrid(best_frame, photo=False)
    if hybrid_meta is not None and hybrid_meta.text.strip():
        best_text = hybrid_meta.text
        best_confs = list(hybrid_meta.confidences)
    return best_text, best_rot, best_confs, hybrid_meta


def ocr_page(
    image, prefer: Optional[int] = None, extra_passes: bool = False
) -> tuple[str, int, list[float], object | None]:
    """OCR one page. Photo path uses ink first; multi-page stays printed."""
    if extra_passes:
        return ocr_photo_page(image)
    return ocr_printed_page(image, prefer=prefer)


def run_ocr_on_bytes(
    data: bytes, max_pages: Optional[int] = None
) -> tuple[str, int, int, int, list[float], object | None]:
    """Returns (text, rotation, pages read, total pages, confs, hybrid_meta)."""
    pages, total = pages_from_bytes(data, max_pages)
    texts: list[str] = []
    all_confs: list[float] = []
    first_rot = 0
    prefer: Optional[int] = None
    extra_passes = len(pages) == 1
    last_hybrid = None

    for index, page in enumerate(pages):
        text, rot, confs, hybrid_meta = ocr_page(
            page, prefer=prefer, extra_passes=extra_passes
        )
        if index == 0:
            first_rot = rot
            prefer = rot
            last_hybrid = hybrid_meta
        if text:
            texts.append(text)
            all_confs.extend(confs)

    log.info(
        "OCR pages=%s/%s rotation=%s chars=%s conf_lines=%s hybrid=%s",
        len(pages), total, first_rot, sum(len(t) for t in texts), len(all_confs),
        last_hybrid is not None,
    )
    return "\n".join(texts).strip(), first_rot, len(pages), total, all_confs, last_hybrid


class OcrJsonRequest(BaseModel):
    image_base64: str = Field(..., description="Raw base64 (no data: URL prefix required)")
    mime_type: Optional[str] = "image/jpeg"
    max_pages: Optional[int] = Field(None, description="Cap for PDFs; server default when unset")


class OcrLineOut(BaseModel):
    text: str
    conf: float
    source: str = "paddle"
    style: str = "printed"


class OcrResponse(BaseModel):
    text: str
    engine: str = "paddleocr"
    chars: int = 0
    rotation: int = 0
    pages: int = 1
    total_pages: int = 1
    truncated: bool = False
    line_confidences: list[float] = Field(default_factory=list)
    avg_confidence: Optional[float] = None
    needs_review: bool = False
    missing_fields: list[str] = Field(default_factory=list)
    lines: list[OcrLineOut] = Field(default_factory=list)
    stats: dict = Field(default_factory=dict)


def _ocr_response(
    text: str,
    rotation: int,
    pages: int,
    total: int,
    confs: list[float],
    hybrid_meta=None,
) -> OcrResponse:
    from field_check import check_fields

    avg = (sum(confs) / len(confs)) if confs else None
    check = check_fields(text)
    lines_out: list[OcrLineOut] = []
    stats: dict = {}
    engine = "paddleocr"
    if hybrid_meta is not None:
        engine = "paddleocr+trocr"
        check.needs_review = hybrid_meta.needs_review
        check.missing_fields = list(hybrid_meta.missing_fields)
        stats = {
            "paddle_boxes": hybrid_meta.stats.paddle_boxes,
            "trocr_boxes": hybrid_meta.stats.trocr_boxes,
            "paddle_fallback_boxes": hybrid_meta.stats.paddle_fallback_boxes,
            "ms_total": round(hybrid_meta.stats.ms_total, 1),
            "ms_det": round(hybrid_meta.stats.ms_det, 1),
            "ms_rec": round(hybrid_meta.stats.ms_rec, 1),
        }
        for ln in hybrid_meta.lines:
            lines_out.append(
                OcrLineOut(
                    text=ln.text,
                    conf=round(float(ln.conf), 4),
                    source=ln.source,
                    style=ln.style,
                )
            )
    return OcrResponse(
        text=text,
        engine=engine,
        chars=len(text),
        rotation=rotation,
        pages=pages,
        total_pages=total,
        truncated=pages < total,
        line_confidences=[round(c, 4) for c in confs],
        avg_confidence=round(avg, 4) if avg is not None else None,
        needs_review=check.needs_review,
        missing_fields=check.missing_fields,
        lines=lines_out,
        stats=stats,
    )


_ocr_lock = None


def _get_ocr_lock():
    global _ocr_lock
    import asyncio

    if _ocr_lock is None:
        _ocr_lock = asyncio.Lock()
    return _ocr_lock


@app.get("/health")
def health():
    hybrid = os.environ.get("HYBRID_OCR", "1").strip() not in ("0", "false", "False")
    counters = {}
    try:
        from pipeline import get_counters

        counters = get_counters()
    except Exception:  # noqa: BLE001
        counters = {
            "handwriting_boxes_total": 0,
            "printed_boxes_total": 0,
            "needs_review_total": 0,
        }
    trocr_ok = False
    try:
        import trocr_onnx

        trocr_ok = trocr_onnx.available()
    except Exception:  # noqa: BLE001
        pass
    rss_mb = None
    try:
        import resource

        rss_mb = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1)
    except Exception:  # noqa: BLE001
        pass
    return {
        "ok": True,
        "service": "transitix-paddle-ocr",
        "engine_loaded": _engine is not None,
        "hybrid": hybrid,
        "use_gpu": os.environ.get("PADDLE_OCR_USE_GPU", "0"),
        "lang": os.environ.get("PADDLE_OCR_LANG", "latin"),
        "auto_rotate": _AUTO_ROTATE,
        "aggressive": _AGGRESSIVE,
        "trocr_available": trocr_ok,
        "trocr_model": os.environ.get("TROCR_ONNX", "trocr-small-handwritten-v1"),
        "classifier_backend": os.environ.get("CLASSIFIER_BACKEND", "heuristic"),
        "memory_profile": os.environ.get("MEMORY_PROFILE", "host"),
        "rss_mb": rss_mb,
        **counters,
    }


@app.post("/debug/classify")
async def debug_classify(
    file: Optional[UploadFile] = File(None),
    image_base64: Optional[str] = Form(None),
):
    """Classify one text crop — printed vs handwritten (no full-document OCR)."""
    import base64
    import io

    import numpy as np
    from PIL import Image

    from classifier import classify_crop

    data = b""
    if file is not None:
        data = await file.read()
    elif image_base64:
        raw = image_base64
        if "," in raw and raw.strip().startswith("data:"):
            raw = raw.split(",", 1)[1]
        data = base64.b64decode(raw)
    else:
        raise HTTPException(status_code=400, detail="Send multipart file or image_base64")
    if not data:
        raise HTTPException(status_code=400, detail="Empty image")
    img = Image.open(io.BytesIO(data)).convert("RGB")
    result = classify_crop(np.array(img))
    return {
        "style": result.style,
        "confidence": result.confidence,
        "backend": result.backend,
        "model": result.model,
    }


@app.post("/ocr", response_model=OcrResponse)
async def ocr_upload(
    file: Optional[UploadFile] = File(None),
    image_base64: Optional[str] = Form(None),
    max_pages: Optional[int] = Form(None),
):
    data = b""
    if file is not None:
        data = await file.read()
    elif image_base64:
        import base64

        raw = image_base64
        if "," in raw and raw.strip().startswith("data:"):
            raw = raw.split(",", 1)[1]
        try:
            data = base64.b64decode(raw)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Invalid base64: {exc}") from exc
    else:
        raise HTTPException(status_code=400, detail="Send multipart file or image_base64")

    if not data:
        raise HTTPException(status_code=400, detail="Empty image")

    async with _get_ocr_lock():
        try:
            text, rotation, pages, total, confs, hybrid = run_ocr_on_bytes(data, max_pages)
        except Exception as exc:  # noqa: BLE001
            log.exception("OCR failed")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return _ocr_response(text, rotation, pages, total, confs, hybrid)


@app.post("/ocr/json", response_model=OcrResponse)
async def ocr_json(body: OcrJsonRequest):
    import base64

    raw = body.image_base64
    if "," in raw and raw.strip().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        data = base64.b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid base64: {exc}") from exc

    if not data:
        raise HTTPException(status_code=400, detail="Empty image")

    async with _get_ocr_lock():
        try:
            text, rotation, pages, total, confs, hybrid = run_ocr_on_bytes(data, body.max_pages)
        except Exception as exc:  # noqa: BLE001
            log.exception("OCR failed")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return _ocr_response(text, rotation, pages, total, confs, hybrid)
