"""
Transitix Tesseract OCR sidecar (Romanian + English).

Same HTTP contract as classic PaddleOCR (:8100):
  GET  /health
  POST /ocr/json  { image_base64, mime_type? }

Preprocess (Gaussian + adaptive threshold) targets ballpoint carnets.
Node decides when to call this after Paddle / VL — see server/src/lib/ocr/readText.js.
"""

from __future__ import annotations

import base64
import io
import logging
import os
from typing import Any, Optional

import cv2
import numpy as np
import pytesseract
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tesseract-ocr")

app = FastAPI(title="Transitix Tesseract OCR", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_LANG = (os.environ.get("TESSERACT_LANG") or "ron+eng").strip() or "ron+eng"
_PDF_MAX_PAGES = int(os.environ.get("TESSERACT_OCR_PDF_PAGES", "8") or 8)
_PDF_DPI = int(os.environ.get("TESSERACT_OCR_PDF_DPI", "220") or 220)
_PSM = int(os.environ.get("TESSERACT_PSM", "6") or 6)  # assume a uniform block of text
_OEM = int(os.environ.get("TESSERACT_OEM", "3") or 3)  # default LSTM


class OcrJsonBody(BaseModel):
    image_base64: str = Field(..., min_length=8)
    mime_type: Optional[str] = None
    max_pages: Optional[int] = None


class OcrResponse(BaseModel):
    text: str
    engine: str = "tesseract"
    chars: int = 0
    pages: int = 1
    total_pages: int = 1
    truncated: bool = False
    lang: str = _LANG


def decode_payload(image_base64: str) -> bytes:
    raw = image_base64.strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        return base64.b64decode(raw, validate=False)
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid base64: {err}") from err


def preprocess_image(bgr: np.ndarray) -> np.ndarray:
    """Grayscale → mild blur → adaptive threshold. Tunable via env later if needed."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if len(bgr.shape) == 3 else bgr
    # Upscale thin phone shots so stroke width is readable to the LSTM.
    h, w = gray.shape[:2]
    long_side = max(h, w)
    if long_side < 1600:
        scale = 1600 / float(long_side)
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    binary = cv2.adaptiveThreshold(
        blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    return binary


def pages_from_bytes(data: bytes, max_pages: Optional[int]) -> tuple[list[np.ndarray], int]:
    """Return OpenCV BGR pages + total page count (PDF or single image)."""
    cap = max_pages if max_pages and max_pages > 0 else _PDF_MAX_PAGES

    if data[:4] == b"%PDF":
        try:
            import fitz  # PyMuPDF
        except ImportError as err:
            raise HTTPException(status_code=500, detail=f"PyMuPDF missing: {err}") from err

        doc = fitz.open(stream=data, filetype="pdf")
        total = doc.page_count
        pages: list[np.ndarray] = []
        for i in range(min(total, cap)):
            page = doc.load_page(i)
            pix = page.get_pixmap(dpi=_PDF_DPI, alpha=False)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
            pages.append(cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
        doc.close()
        return pages, total

    arr = np.frombuffer(data, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        # Pillow fallback for odd encodings
        pil = Image.open(io.BytesIO(data)).convert("RGB")
        bgr = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    return [bgr], 1


def run_tesseract(bgr: np.ndarray) -> str:
    prepared = preprocess_image(bgr)
    config = f"--oem {_OEM} --psm {_PSM}"
    text = pytesseract.image_to_string(prepared, lang=_LANG, config=config)
    return (text or "").strip()


@app.get("/health")
def health() -> dict[str, Any]:
    version = None
    try:
        version = pytesseract.get_tesseract_version()
    except Exception:  # noqa: BLE001
        version = None
    return {
        "ok": True,
        "service": "transitix-tesseract-ocr",
        "lang": _LANG,
        "tesseract_version": str(version) if version is not None else None,
        "psm": _PSM,
        "oem": _OEM,
    }


@app.post("/ocr/json", response_model=OcrResponse)
def ocr_json(body: OcrJsonBody) -> OcrResponse:
    data = decode_payload(body.image_base64)
    if not data:
        raise HTTPException(status_code=400, detail="Empty image")

    try:
        pages, total = pages_from_bytes(data, body.max_pages)
        chunks: list[str] = []
        for page in pages:
            chunk = run_tesseract(page)
            if chunk:
                chunks.append(chunk)
        text = "\n\n".join(chunks)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        log.exception("Tesseract OCR failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return OcrResponse(
        text=text,
        engine="tesseract",
        chars=len(text),
        pages=len(pages),
        total_pages=total,
        truncated=len(pages) < total,
        lang=_LANG,
    )
