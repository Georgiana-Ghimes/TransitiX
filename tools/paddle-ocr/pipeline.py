"""Hybrid OCR: Paddle det (PATH B) → classify → Paddle or TrOCR rec.

CHOSEN_PATH from Gate 1: engine.text_detector + engine.text_recognizer.
When HYBRID_OCR=0, callers keep using ocr_array (legacy).
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np

from classifier import classify_crop
from field_check import check_fields

log = logging.getLogger("paddle-ocr.pipeline")

Source = Literal["paddle", "trocr", "paddle_fallback"]


def _flag(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip() not in ("0", "false", "False", "")


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)) or default)
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)) or default)
    except ValueError:
        return default


@dataclass
class OcrLine:
    text: str
    conf: float
    source: Source
    style: Literal["printed", "handwritten"]
    box: list[list[float]] | None = None


@dataclass
class HybridStats:
    paddle_boxes: int = 0
    trocr_boxes: int = 0
    paddle_fallback_boxes: int = 0
    ms_det: float = 0.0
    ms_rec: float = 0.0
    ms_total: float = 0.0
    trocr_loaded: bool = False


@dataclass
class HybridResult:
    text: str
    lines: list[OcrLine] = field(default_factory=list)
    confidences: list[float] = field(default_factory=list)
    stats: HybridStats = field(default_factory=HybridStats)
    needs_review: bool = False
    missing_fields: list[str] = field(default_factory=list)


# Process counters for /health
_counters = {
    "handwriting_boxes_total": 0,
    "printed_boxes_total": 0,
    "needs_review_total": 0,
}


def get_counters() -> dict[str, int]:
    return dict(_counters)


def _crop_box(arr: np.ndarray, box) -> np.ndarray | None:
    pts = np.asarray(box, dtype="float32").reshape(-1, 2)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    x0, y0 = max(0, int(x0) - 2), max(0, int(y0) - 2)
    x1, y1 = min(arr.shape[1], int(x1) + 2), min(arr.shape[0], int(y1) + 2)
    if x1 <= x0 or y1 <= y0:
        return None
    return arr[y0:y1, x0:x1]


def _box_sort_key(box) -> tuple[float, float]:
    pts = np.asarray(box, dtype="float32").reshape(-1, 2)
    return float(pts[:, 1].min()), float(pts[:, 0].min())


def detect_boxes(engine, arr: np.ndarray) -> list[Any]:
    """PATH B: text_detector."""
    det = getattr(engine, "text_detector", None)
    if det is None:
        raise RuntimeError("engine.text_detector missing — Gate 1 PATH B required")
    out = det(arr)
    dt_boxes = out[0] if isinstance(out, tuple) else out
    return list(dt_boxes) if dt_boxes is not None else []


def recognize_paddle(engine, crop: np.ndarray) -> tuple[str, float]:
    """PATH B: text_recognizer on one crop."""
    rec = getattr(engine, "text_recognizer", None)
    if rec is None:
        raise RuntimeError("engine.text_recognizer missing — Gate 1 PATH B required")
    rec_out = rec([crop])
    flat = rec_out[0] if isinstance(rec_out, tuple) else rec_out
    if isinstance(flat, list) and flat:
        first = flat[0]
        if isinstance(first, (list, tuple)) and first and isinstance(first[0], (list, tuple)):
            first = first[0]
        if isinstance(first, (list, tuple)) and first:
            text = str(first[0])
            conf = 0.0
            if len(first) > 1:
                try:
                    conf = float(first[1])
                except (TypeError, ValueError):
                    conf = 0.0
            return text, conf
    return "", 0.0


def ocr_hybrid(engine, arr: np.ndarray) -> HybridResult:
    """Detect → classify → Paddle or TrOCR; apply printed/HW fallbacks."""
    t0 = time.perf_counter()
    stats = HybridStats()
    lines: list[OcrLine] = []

    t_det = time.perf_counter()
    boxes = detect_boxes(engine, arr)
    stats.ms_det = (time.perf_counter() - t_det) * 1000.0
    boxes = sorted(boxes, key=_box_sort_key)

    printed_fallback = _float("PRINTED_FALLBACK_CONF", 0.5)
    hw_threshold = _float("HANDWRITING_THRESHOLD", 0.75)
    hw_min_len = _int("HANDWRITING_MIN_LEN", 2)
    # When paddle already reads a crop well, keep it — even if the heuristic
    # said handwritten (common on dense printed PDFs with HW_BIAS).
    hw_paddle_keep = _float("HANDWRITING_PADDLE_KEEP", 0.55)

    trocr_mod = None
    if _flag("HYBRID_OCR", "1"):
        try:
            import trocr_onnx as trocr_mod
        except ImportError:
            trocr_mod = None

    t_rec = time.perf_counter()
    for box in boxes:
        crop = _crop_box(arr, box)
        if crop is None or crop.size == 0:
            continue

        clf = classify_crop(crop)
        if clf.style == "handwritten":
            _counters["handwriting_boxes_total"] += 1
        else:
            _counters["printed_boxes_total"] += 1

        paddle_text, paddle_conf = recognize_paddle(engine, crop)
        source: Source = "paddle"
        style = clf.style
        text, conf = paddle_text, paddle_conf

        use_trocr = False
        if style == "handwritten" and paddle_conf < hw_paddle_keep:
            use_trocr = True
        elif style == "printed" and paddle_conf < printed_fallback:
            use_trocr = True

        trocr_ready = trocr_mod is not None and trocr_mod.available()
        if use_trocr and trocr_ready:
            tr = trocr_mod.recognize_crop(crop)
            stats.trocr_loaded = True
            if tr is not None and tr.text.strip():
                tlen = len(tr.text.strip())
                if tr.conf >= hw_threshold and tlen >= hw_min_len:
                    text, conf = tr.text, tr.conf
                    source = "trocr"
                    stats.trocr_boxes += 1
                else:
                    # Tried TrOCR but noise / low conf → keep Paddle, mark fallback
                    text, conf = paddle_text, paddle_conf
                    source = "paddle_fallback"
                    stats.paddle_fallback_boxes += 1
            elif paddle_text.strip():
                source = "paddle_fallback"
                stats.paddle_fallback_boxes += 1
            else:
                # Empty from both — still count as attempted TrOCR
                stats.trocr_boxes += 1
        else:
            if use_trocr and not trocr_ready:
                log.debug("TrOCR unavailable — paddle on HW/low-conf crop")
            stats.paddle_boxes += 1

        if not (text or "").strip():
            continue
        box_list = np.asarray(box, dtype=float).reshape(-1, 2).tolist()
        lines.append(
            OcrLine(
                text=text.strip(),
                conf=float(conf),
                source=source,
                style=style,
                box=box_list,
            )
        )

    stats.ms_rec = (time.perf_counter() - t_rec) * 1000.0
    stats.ms_total = (time.perf_counter() - t0) * 1000.0

    if trocr_mod is not None and _flag("TROCR_UNLOAD_AFTER_REQUEST", "1"):
        try:
            trocr_mod.unload()
        except Exception:  # noqa: BLE001
            pass

    blob = "\n".join(ln.text for ln in lines)
    confs = [ln.conf for ln in lines]
    check = check_fields(blob)
    if check.needs_review:
        _counters["needs_review_total"] += 1

    log.info(
        "hybrid boxes=%s paddle=%s trocr=%s fallback=%s ms=%.0f needs_review=%s missing=%s",
        len(lines),
        stats.paddle_boxes,
        stats.trocr_boxes,
        stats.paddle_fallback_boxes,
        stats.ms_total,
        check.needs_review,
        check.missing_fields,
    )

    return HybridResult(
        text=blob.strip(),
        lines=lines,
        confidences=confs,
        stats=stats,
        needs_review=check.needs_review,
        missing_fields=check.missing_fields,
    )
