"""
Local PaddleOCR HTTP service for Transitix.

Transitix Node calls POST /ocr with an image (or PDF page bytes as image).
Keep this process separate — heavy ML deps stay out of the Node API.

Quick wins baked in:
  - Page auto-rotation (0/90/180/270) scored by OCR confidence + RO doc keywords
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


def run_ocr_on_bytes(data: bytes) -> tuple[str, int]:
    """
    OCR image bytes. Returns (text, rotation_degrees_clockwise).
    Tries other page orientations when the first pass looks weak.
    """
    from PIL import Image
    import numpy as np

    image = Image.open(io.BytesIO(data)).convert("RGB")
    rotations = [0, 90, 270, 180] if _AUTO_ROTATE else [0]

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
        # Fast path: upright printouts with a clear TPO/PSL skip other angles.
        if degrees == 0 and looks_upright_enough(text, score):
            break

    return best_text, best_rot


def lines_from_result(result) -> str:
    text, _ = lines_and_conf_from_result(result)
    return text


class OcrJsonRequest(BaseModel):
    image_base64: str = Field(..., description="Raw base64 (no data: URL prefix required)")
    mime_type: Optional[str] = "image/jpeg"


class OcrResponse(BaseModel):
    text: str
    engine: str = "paddleocr"
    chars: int = 0
    rotation: int = 0


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
        text, rotation = run_ocr_on_bytes(data)
    except Exception as exc:  # noqa: BLE001
        log.exception("OCR failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return OcrResponse(text=text, engine="paddleocr", chars=len(text), rotation=rotation)


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
        text, rotation = run_ocr_on_bytes(data)
    except Exception as exc:  # noqa: BLE001
        log.exception("OCR failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return OcrResponse(text=text, engine="paddleocr", chars=len(text), rotation=rotation)
