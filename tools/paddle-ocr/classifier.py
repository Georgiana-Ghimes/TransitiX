"""Printed vs handwritten crop classifier (CPU).

Default backend: stroke/ink heuristic (no ONNX in RAM).
Optional: CLASSIFIER_BACKEND=onnx + CLASSIFIER_ONNX model.
HW_BIAS=1 → ambiguous crops route to handwritten (demo HW-first).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Literal

import numpy as np

log = logging.getLogger("paddle-ocr.classifier")

Style = Literal["printed", "handwritten"]


def _env_flag(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip() not in ("0", "false", "False", "")


@dataclass
class ClassifyResult:
    style: Style
    confidence: float
    backend: str
    model: str | None = None


def _heuristic(crop_rgb: np.ndarray) -> ClassifyResult:
    """Stroke irregularity heuristic — fast, no model download."""
    import cv2

    if crop_rgb is None or crop_rgb.size == 0:
        return ClassifyResult("handwritten", 0.5, "heuristic")

    if crop_rgb.ndim == 3:
        gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    else:
        gray = crop_rgb

    h, w = gray.shape[:2]
    if h < 4 or w < 4:
        return ClassifyResult("handwritten", 0.55, "heuristic")

    # Adaptive binary — ink = dark
    bw = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 7
    )
    ink = float(np.count_nonzero(bw)) / float(bw.size)
    # Horizontal projection variance: handwriting is bumpier than print
    proj = bw.sum(axis=1).astype(np.float32)
    if proj.mean() > 0:
        proj_cv = float(proj.std() / (proj.mean() + 1e-6))
    else:
        proj_cv = 0.0
    # Edge density
    edges = cv2.Canny(gray, 40, 120)
    edge_d = float(np.count_nonzero(edges)) / float(edges.size)

    # Printed: moderate ink, smoother projection, cleaner edges
    # HW: higher projection CV, messier edges, often thinner ink coverage
    score_hw = 0.0
    if proj_cv > 0.85:
        score_hw += 0.35
    elif proj_cv > 0.55:
        score_hw += 0.2
    if edge_d > 0.12:
        score_hw += 0.25
    elif edge_d > 0.07:
        score_hw += 0.1
    if 0.02 <= ink <= 0.22:
        score_hw += 0.15  # thin ballpoint band
    if ink > 0.35:
        score_hw -= 0.2  # filled / bold print

    # Aspect: very tall single glyphs vs wide printed lines — weak signal
    aspect = w / float(h)
    if aspect > 8:
        score_hw += 0.05

    score_hw = max(0.0, min(1.0, score_hw))
    hw_bias = _env_flag("HW_BIAS", "1")
    threshold = 0.42 if hw_bias else 0.55

    if score_hw >= threshold:
        return ClassifyResult("handwritten", round(score_hw, 3), "heuristic")
    conf_print = round(1.0 - score_hw, 3)
    if hw_bias and 0.35 <= score_hw < threshold:
        # Ambiguous → handwritten for demo
        return ClassifyResult("handwritten", round(max(score_hw, 0.51), 3), "heuristic")
    return ClassifyResult("printed", conf_print, "heuristic")


_onnx_session = None
_onnx_name: str | None = None


def _onnx_classify(crop_rgb: np.ndarray) -> ClassifyResult | None:
    global _onnx_session, _onnx_name
    model = os.environ.get("CLASSIFIER_ONNX", "mobilenetv3-text-style-v1.onnx").strip()
    model_dir = os.environ.get(
        "OCR_ONNX_DIR",
        os.path.join(os.path.expanduser("~"), ".paddleocr", "onnx"),
    )
    path = model if os.path.isabs(model) else os.path.join(model_dir, model)
    if not os.path.isfile(path):
        return None
    try:
        import cv2
        import onnxruntime as ort
    except ImportError:
        return None

    if _onnx_session is None or _onnx_name != path:
        _onnx_session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        _onnx_name = path
        log.info("Loaded classifier ONNX %s", path)

    img = cv2.resize(crop_rgb, (224, 224))
    x = img.astype(np.float32) / 255.0
    x = np.transpose(x, (2, 0, 1))[None, ...]
    inp = _onnx_session.get_inputs()[0].name
    out = _onnx_session.run(None, {inp: x})[0]
    probs = out.reshape(-1)
    # Assume [printed, handwritten]
    if probs.size < 2:
        return None
    # softmax if logits
    if probs.min() < 0 or probs.max() > 1.5:
        e = np.exp(probs - probs.max())
        probs = e / e.sum()
    hw = float(probs[1])
    style: Style = "handwritten" if hw >= 0.5 else "printed"
    if _env_flag("HW_BIAS", "1") and 0.4 <= hw < 0.5:
        style = "handwritten"
    return ClassifyResult(style, round(max(hw, 1.0 - hw), 3), "onnx", os.path.basename(path))


def classify_crop(crop_rgb: np.ndarray) -> ClassifyResult:
    """Return printed|handwritten for one text crop (RGB uint8)."""
    backend = os.environ.get("CLASSIFIER_BACKEND", "heuristic").strip().lower()
    if backend == "onnx":
        got = _onnx_classify(crop_rgb)
        if got is not None:
            return got
        log.warning("CLASSIFIER_BACKEND=onnx but model missing — heuristic fallback")
    return _heuristic(crop_rgb)
