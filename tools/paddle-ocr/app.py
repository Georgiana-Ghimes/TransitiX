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
        log.info("Loading PaddleOCR (lang=%s, gpu=%s, auto_rotate=%s)", lang, use_gpu, _AUTO_ROTATE)
        try:
            _engine = PaddleOCR(
                use_angle_cls=True,
                lang=lang,
                use_gpu=use_gpu,
                show_log=False,
                # Defaults (~0.6) drop faint blue ballpoint on cream paper under monitor glare.
                det_db_box_thresh=float(os.environ.get("PADDLE_OCR_DET_THRESH", "0.3") or 0.3),
                drop_score=float(os.environ.get("PADDLE_OCR_DROP_SCORE", "0.35") or 0.35),
            )
        except TypeError:
            try:
                _engine = PaddleOCR(
                    use_angle_cls=True,
                    lang=lang,
                    use_gpu=use_gpu,
                    show_log=False,
                )
            except TypeError:
                _engine = PaddleOCR(lang=lang)
        return _engine
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

    frame = upscale_for_ocr(image, 1600, 2.0)
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


def emphasize_ink(image):
    """
    Blue ballpoint on cream paper under a green monitor cast.

    The green glow lifts the paper toward the ink's chroma; a plain RGB OCR pass then sees
    low contrast. Taking the darker of R/G (where blue ink is darkest) before grayscale
    recovers the strokes without a hard binarize that kills handwriting.
    """
    from PIL import Image
    import numpy as np

    frame = upscale_for_ocr(image.convert("RGB"), 2200, 3.0)
    try:
        arr = np.asarray(frame).astype("float32")
        ink = np.min(arr[:, :, :2], axis=2)  # R and G; blue ink sinks both
        ink = np.clip(ink, 0, 255).astype("uint8")
        return Image.fromarray(ink).convert("RGB")
    except Exception:
        return frame


def flatten_shadow(image):
    """
    Divide the page by its own blur, which removes the hand / phone shadow a driver casts.

    Uneven light is the single most common defect in cab photos, and it defeats global contrast
    because half the sheet is correctly exposed.
    """
    from PIL import Image

    frame = upscale_for_ocr(image, 1600, 2.0)
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


def ocr_photo_page(image) -> tuple[str, int]:
    """
    Phone photo of a notebook (or any single-page hard shot).

    Raw RGB under a green monitor cast often returns *nothing*. Spending four orientations on
    that empty read burns the interactive budget and never reaches the ink/upscale passes.
    So photos start on an ink-emphasised, upscaled frame, then rotate that prepared image.
    """
    import numpy as np

    rotations = [0, 90, 270, 180] if _AUTO_ROTATE else [0]
    best_text = ""
    best_score = -1.0
    best_rot = 0
    best_source = image

    for degrees in rotations:
        frame = image if degrees == 0 else image.rotate(-degrees, expand=True)
        prepared = emphasize_ink(frame)
        text, confs = ocr_array(np.array(prepared))
        score = _score_frame(text, confs, frame)
        log.info("OCR photo rotation=%s score=%.2f chars=%s (ink)", degrees, score, len(text))
        if score > best_score:
            best_score = score
            best_text = text
            best_rot = degrees
            best_source = frame
        # Phone notebooks are almost always upright; stop when TPO/PSL already reads.
        if degrees == rotations[0] and looks_upright_enough(text, score):
            break
        if looks_upright_enough(text, score) and degrees != 0:
            break

    if _AGGRESSIVE:
        passes = (
            ("enhance", enhance_for_ocr),
            ("shadow", flatten_shadow),
            ("clahe", enhance_aggressive),
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
            best_text, best_score = _merge_ocr_text(best_text, best_score, text, score)

    return best_text, best_rot


def ocr_printed_page(image, prefer: Optional[int] = None) -> tuple[str, int]:
    """Scanned / printed pages: raw pixels first, no phone-photo preprocess."""
    import numpy as np

    rotations = [0, 90, 270, 180] if _AUTO_ROTATE else [0]
    if prefer is not None and prefer in rotations:
        rotations = [prefer] + [d for d in rotations if d != prefer]
    best_text = ""
    best_score = -1.0
    best_rot = 0

    for degrees in rotations:
        frame = image if degrees == 0 else image.rotate(-degrees, expand=True)
        text, confs = ocr_array(np.array(frame.convert("RGB")))
        score = _score_frame(text, confs, frame)
        log.info("OCR rotation=%s score=%.2f chars=%s (raw)", degrees, score, len(text))
        if score > best_score:
            best_score = score
            best_text = text
            best_rot = degrees
        if degrees == rotations[0] and looks_upright_enough(text, score):
            break

    return best_text, best_rot


def ocr_page(image, prefer: Optional[int] = None, extra_passes: bool = False) -> tuple[str, int]:
    """
    OCR one page.

    `extra_passes` means a single phone photo — use the notebook path (ink first).
    Multi-page scans stay on the printed path so clean PDFs stay fast and accurate.
    """
    if extra_passes:
        return ocr_photo_page(image)
    return ocr_printed_page(image, prefer=prefer)


def run_ocr_on_bytes(data: bytes, max_pages: Optional[int] = None) -> tuple[str, int, int, int]:
    """
    OCR image or PDF bytes.

    Returns (text, rotation of the first page, pages read, pages the document has).
    """
    pages, total = pages_from_bytes(data, max_pages)
    texts: list[str] = []
    first_rot = 0
    prefer: Optional[int] = None
    # A photo is one page and worth re-rendering; a dossier is not.
    extra_passes = len(pages) == 1

    for index, page in enumerate(pages):
        text, rot = ocr_page(page, prefer=prefer, extra_passes=extra_passes)
        if index == 0:
            first_rot = rot
            prefer = rot
        if text:
            texts.append(text)

    log.info(
        "OCR pages=%s/%s rotation=%s chars=%s",
        len(pages), total, first_rot, sum(len(t) for t in texts),
    )
    return "\n".join(texts).strip(), first_rot, len(pages), total


class OcrJsonRequest(BaseModel):
    image_base64: str = Field(..., description="Raw base64 (no data: URL prefix required)")
    mime_type: Optional[str] = "image/jpeg"
    max_pages: Optional[int] = Field(None, description="Cap for PDFs; server default when unset")


class OcrResponse(BaseModel):
    text: str
    engine: str = "paddleocr"
    chars: int = 0
    rotation: int = 0
    pages: int = 1
    total_pages: int = 1
    # A caller that stored a partial read as if it were the whole document would put an
    # understated figure on an invoice. Say so instead.
    truncated: bool = False


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "transitix-paddle-ocr",
        "engine_loaded": _engine is not None,
        "use_gpu": os.environ.get("PADDLE_OCR_USE_GPU", "0"),
        "lang": os.environ.get("PADDLE_OCR_LANG", "latin"),
        "auto_rotate": _AUTO_ROTATE,
        "aggressive": _AGGRESSIVE,
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

    try:
        text, rotation, pages, total = run_ocr_on_bytes(data, max_pages)
    except Exception as exc:  # noqa: BLE001
        log.exception("OCR failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return OcrResponse(
        text=text, engine="paddleocr", chars=len(text), rotation=rotation,
        pages=pages, total_pages=total, truncated=pages < total,
    )


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

    try:
        text, rotation, pages, total = run_ocr_on_bytes(data, body.max_pages)
    except Exception as exc:  # noqa: BLE001
        log.exception("OCR failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return OcrResponse(
        text=text, engine="paddleocr", chars=len(text), rotation=rotation,
        pages=pages, total_pages=total, truncated=pages < total,
    )
