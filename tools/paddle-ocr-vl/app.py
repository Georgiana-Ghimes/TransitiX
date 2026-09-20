"""
PaddleOCR-VL 0.9B HTTP sidecar for Transitix.

Complement to the classic PaddleOCR service on :8100. This one runs the 0.9B
document VLM (Romanian + handwriting-friendly) on CPU. Node calls it as a
fallback when classic OCR text is thin.

Contract mirrors classic /ocr/json so readText.js can reuse the same client shape.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import tempfile
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("paddle-ocr-vl")

app = FastAPI(title="Transitix PaddleOCR-VL", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_pipeline = None
_PDF_MAX_PAGES = int(os.environ.get("PADDLE_OCR_VL_PDF_PAGES", "8") or 8)
_PDF_DPI = int(os.environ.get("PADDLE_OCR_VL_PDF_DPI", "200") or 200)
_DEVICE = (os.environ.get("PADDLE_OCR_VL_DEVICE") or "cpu").strip() or "cpu"


class OcrJsonBody(BaseModel):
    image_base64: str = Field(..., min_length=8)
    mime_type: Optional[str] = None


def get_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    try:
        from paddleocr import PaddleOCRVL
    except ImportError as err:
        raise RuntimeError(
            "paddleocr[doc-parser] / PaddleOCRVL missing — rebuild the image"
        ) from err

    log.info("Loading PaddleOCRVL device=%s (first load downloads models)", _DEVICE)
    # CPU is the supported path on AMD hosts; NVIDIA Docker is a separate stack.
    kwargs: dict[str, Any] = {"device": _DEVICE}
    try:
        _pipeline = PaddleOCRVL(**kwargs)
    except TypeError:
        # Older / newer signatures may not take device= the same way.
        _pipeline = PaddleOCRVL()
    return _pipeline


def decode_payload(image_base64: str) -> bytes:
    raw = image_base64.strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        return base64.b64decode(raw, validate=False)
    except Exception as err:
        raise HTTPException(status_code=400, detail=f"invalid base64: {err}") from err


def pages_from_bytes(data: bytes) -> tuple[list, int]:
    from PIL import Image

    if data[:4] != b"%PDF":
        return [Image.open(io.BytesIO(data)).convert("RGB")], 1

    import fitz

    pages = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        total = doc.page_count
        for index, page in enumerate(doc):
            if index >= _PDF_MAX_PAGES:
                break
            pix = page.get_pixmap(dpi=_PDF_DPI)
            pages.append(Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB"))
    if not pages:
        raise ValueError("PDF has no pages")
    return pages, total


def _coerce_text(res: Any) -> str:
    """Best-effort plain/markdown text from one PaddleOCRVL page result."""
    if res is None:
        return ""
    if isinstance(res, str):
        return res.strip()
    if isinstance(res, dict):
        for key in ("markdown", "md", "text", "rec_text", "content"):
            val = res.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        # Nested paddlex shape: {"res": {"markdown": "..."}}
        nested = res.get("res")
        if isinstance(nested, dict):
            return _coerce_text(nested)
        return ""

    md = getattr(res, "markdown", None)
    if isinstance(md, str) and md.strip():
        return md.strip()
    if callable(md):
        try:
            out = md()
            if isinstance(out, str) and out.strip():
                return out.strip()
        except Exception:
            pass

    data = getattr(res, "json", None)
    if callable(data):
        try:
            data = data()
        except Exception:
            data = None
    if isinstance(data, dict):
        got = _coerce_text(data)
        if got:
            return got

    # Last resort: strip noise from repr / str
    text = str(res).strip()
    if len(text) > 40 and not text.startswith("<"):
        return text
    return ""


def run_vl_on_images(images: list) -> str:
    pipeline = get_pipeline()
    chunks: list[str] = []

    for index, image in enumerate(images):
        # predict() accepts paths most reliably across paddleocr versions.
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            path = tmp.name
            image.save(path, format="PNG")
        try:
            output = pipeline.predict(path)
        except TypeError:
            # Some builds want a list / numpy array.
            import numpy as np

            output = pipeline.predict(np.array(image))
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

        if output is None:
            continue
        # predict may return a generator, list, or single result
        items = list(output) if not isinstance(output, (str, dict)) and hasattr(output, "__iter__") else [output]
        page_bits = []
        for item in items:
            bit = _coerce_text(item)
            if bit:
                page_bits.append(bit)
        if page_bits:
            chunks.append(f"--- page {index + 1} ---\n" + "\n".join(page_bits))

    return "\n\n".join(chunks).strip()


@app.get("/health")
def health():
    ready = _pipeline is not None
    return {
        "ok": True,
        "service": "paddle-ocr-vl",
        "device": _DEVICE,
        "model_loaded": ready,
        "model": "PaddleOCR-VL-0.9B",
    }


@app.post("/ocr/json")
def ocr_json(body: OcrJsonBody):
    data = decode_payload(body.image_base64)
    try:
        images, total = pages_from_bytes(data)
    except Exception as err:
        raise HTTPException(status_code=400, detail=f"cannot read file: {err}") from err

    try:
        text = run_vl_on_images(images)
    except Exception as err:
        log.exception("PaddleOCR-VL failed")
        raise HTTPException(status_code=500, detail=str(err)) from err

    truncated = total > len(images)
    return {
        "text": text,
        "source": "paddle-vl",
        "pages": len(images),
        "total_pages": total,
        "truncated": truncated,
        "engine": "PaddleOCR-VL-0.9B",
        "device": _DEVICE,
    }


@app.on_event("startup")
def warm_hint():
    log.info(
        "PaddleOCR-VL sidecar listening — models load on first /ocr/json (device=%s)",
        _DEVICE,
    )
