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
_CODE_RE = re.compile(r"(?:TPO|PSL|TRO)[\s\-._]*\d{3,}", re.I)
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
_PDF_DPI = int(os.environ.get("PADDLE_OCR_PDF_DPI", "200") or 200)
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


def score_ocr(text: str, confidences: list[float]) -> float:
    """Higher = more likely upright logistics document."""
    blob = text or ""
    if not blob.strip():
        return -1.0

    avg_conf = sum(confidences) / len(confidences) if confidences else 0.35
    score = avg_conf * 10.0
    score += min(len(blob) / 80.0, 6.0)
    score += min(len(_KEYWORD_RE.findall(blob)), 8) * 1.5
    if _CODE_RE.search(blob):
        score += 6.0
    if _PLATE_RE.search(blob):
        score += 3.0
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


def ocr_page(image, prefer: Optional[int] = None) -> tuple[str, int]:
    """
    OCR one page, trying other orientations when the first pass looks weak.

    `prefer` is the angle that won on an earlier page. A scanner feeds every sheet the same way,
    so trying it first turns a four-orientation search per page into one — which is the
    difference between a ten-page scan finishing and timing out.
    """
    import numpy as np

    rotations = [0, 90, 270, 180] if _AUTO_ROTATE else [0]
    if prefer is not None and prefer in rotations:
        rotations = [prefer] + [d for d in rotations if d != prefer]
    best_text = ""
    best_score = -1.0
    best_rot = 0

    for degrees in rotations:
        frame = image if degrees == 0 else image.rotate(-degrees, expand=True)
        text, confs = ocr_array(np.array(frame))
        score = score_ocr(text, confs)
        log.info("OCR rotation=%s score=%.2f chars=%s", degrees, score, len(text))
        if score > best_score:
            best_score = score
            best_text = text
            best_rot = degrees
        # Fast path: a page that already reads like an upright document skips other angles.
        if degrees == rotations[0] and looks_upright_enough(text, score):
            break

    return best_text, best_rot


def run_ocr_on_bytes(data: bytes, max_pages: Optional[int] = None) -> tuple[str, int, int, int]:
    """
    OCR image or PDF bytes.

    Returns (text, rotation of the first page, pages read, pages the document has).
    """
    pages, total = pages_from_bytes(data, max_pages)
    texts: list[str] = []
    first_rot = 0
    prefer: Optional[int] = None

    for index, page in enumerate(pages):
        text, rot = ocr_page(page, prefer=prefer)
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
