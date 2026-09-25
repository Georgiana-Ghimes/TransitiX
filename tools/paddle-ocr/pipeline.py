"""Hybrid OCR: Paddle det (PATH B) → classify → Paddle / HTR latin / TrOCR rec.

CHOSEN_PATH from Gate 1: engine.text_detector + engine.text_recognizer.
When HYBRID_OCR=0, callers keep using ocr_array (legacy).

photo=True (phone / notebook): stricter background-box filter, higher
HANDWRITING_PADDLE_KEEP_PHOTO so HTR is tried more often on HW crops.
Default handwriting path is latin-extended HTR (USE_HTR_LATIN=1), not English TrOCR.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np

from classifier import classify_crop
from field_check import check_fields
from ro_post import normalize_ro_document, normalize_ro_line

log = logging.getLogger("paddle-ocr.pipeline")

Source = Literal["paddle", "htr_latin", "trocr", "paddle_fallback"]

# TrOCR-small is IAM English — off by default. Set USE_TROCR=1 only for experiments.
_EN_JUNK_RE = re.compile(
    r"(help|learn\s*to\s*edit|community\s*portal|recent\s*changes|upload\s*file|"
    r"wikipedia|click\s*here|sign\s*in|password|http://|https://|"
    r"main\s*page|talk\s*page|special\s*pages)",
    re.I,
)
_CAMEL_WIKI_RE = re.compile(r"[a-z]{3,}[A-Z][a-z]{2,}")


def _trocr_enabled() -> bool:
    return _flag("USE_TROCR", "0")


def _htr_enabled() -> bool:
    return _flag("USE_HTR_LATIN", "1")


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
    htr_latin_boxes: int = 0
    trocr_boxes: int = 0
    paddle_fallback_boxes: int = 0
    ms_det: float = 0.0
    ms_rec: float = 0.0
    ms_total: float = 0.0
    htr_loaded: bool = False
    trocr_loaded: bool = False
    boxes_dropped: int = 0


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


def _box_center(box) -> np.ndarray:
    return np.asarray(box, dtype=float).reshape(-1, 2).mean(axis=0)


def filter_outlier_boxes(boxes: list[Any], shape: tuple[int, ...]) -> tuple[list[Any], int]:
    """Drop detection boxes on the image fringe far from the main cluster (TV / table)."""
    if len(boxes) < 5:
        return boxes, 0
    h, w = int(shape[0]), int(shape[1])
    centers = np.array([_box_center(b) for b in boxes])
    med = np.median(centers, axis=0)
    qx1, qx3 = np.percentile(centers[:, 0], [8, 92])
    qy1, qy3 = np.percentile(centers[:, 1], [5, 95])
    dx = max(float(qx3 - qx1), w * 0.15)
    dy = max(float(qy3 - qy1), h * 0.15)
    x0, x1 = qx1 - 0.55 * dx, qx3 + 0.55 * dx
    y0, y1 = qy1 - 0.45 * dy, qy3 + 0.45 * dy
    edge = 0.07
    kept = []
    for box, c in zip(boxes, centers):
        in_core = x0 <= c[0] <= x1 and y0 <= c[1] <= y1
        near_edge = (
            c[0] < w * edge
            or c[0] > w * (1.0 - edge)
            or c[1] < h * edge
            or c[1] > h * (1.0 - edge)
        )
        dist = float(np.linalg.norm(c - med))
        # Only drop fringe outliers — keep mid-page lines even if sparse.
        if (not in_core) and near_edge and dist > 0.22 * ((h ** 2 + w ** 2) ** 0.5):
            continue
        kept.append(box)
    dropped = len(boxes) - len(kept)
    if len(kept) < max(3, len(boxes) // 2):
        return boxes, 0
    if dropped:
        log.info("photo filter dropped %s fringe outlier box(es)", dropped)
    return kept, dropped


def trocr_looks_english_junk(text: str) -> bool:
    """True when TrOCR (IAM-EN) hallucinated UI/wiki English instead of RO HW."""
    t = (text or "").strip()
    if not t:
        return False
    if _EN_JUNK_RE.search(t):
        return True
    if len(t) >= 24 and len(_CAMEL_WIKI_RE.findall(t)) >= 2:
        return True
    # Long English-looking token salad without digits / RO logistics markers
    if len(t) >= 40 and not re.search(r"\d", t):
        words = re.findall(r"[A-Za-z]{4,}", t)
        if len(words) >= 4:
            return True
    return False


_LOGISTICS_CODE = re.compile(
    r"(?:T\s*P\s*[O0Q]|P\s*S\s*L|T\s*R\s*O)[\s\-._]*[0-9A-Za-z]{3,}",
    re.I,
)
_LOGISTICS_PLATE = re.compile(
    r"\b(?:B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|"
    r"HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)"
    r"[\s\-]?\d{2,3}[\s\-]?[A-Z]{2,3}\b",
    re.I,
)
_LOGISTICS_DATE = re.compile(r"\b\d{1,2}[./\-]\d{1,2}[./\-]20\d{2}\b")


def logistics_signal(text: str) -> int:
    """How many concrete logistics tokens a crop already carries."""
    t = text or ""
    return (
        len(_LOGISTICS_CODE.findall(t))
        + len(_LOGISTICS_PLATE.findall(t))
        + len(_LOGISTICS_DATE.findall(t))
    )


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


def ocr_hybrid(engine, arr: np.ndarray, *, photo: bool = False) -> HybridResult:
    """Detect → classify → Paddle, HTR latin (HW), or optional TrOCR."""
    t0 = time.perf_counter()
    stats = HybridStats()
    lines: list[OcrLine] = []

    t_det = time.perf_counter()
    boxes = detect_boxes(engine, arr)
    if photo:
        boxes, dropped = filter_outlier_boxes(boxes, arr.shape)
        stats.boxes_dropped = dropped
    stats.ms_det = (time.perf_counter() - t_det) * 1000.0
    boxes = sorted(boxes, key=_box_sort_key)

    printed_fallback = _float("PRINTED_FALLBACK_CONF", 0.5)
    # CTC mean-step conf is softer than TrOCR; default 0.35 keeps useful HW lines.
    hw_threshold = _float("HANDWRITING_THRESHOLD", 0.35)
    hw_min_len = _int("HANDWRITING_MIN_LEN", 2)
    # Printed PDFs: keep paddle when already confident (misclassified HW).
    # Phone HW: try HTR sooner — paddle often scores 0.6–0.85 on wrong glyphs.
    if photo:
        hw_paddle_keep = _float("HANDWRITING_PADDLE_KEEP_PHOTO", 0.90)
    else:
        hw_paddle_keep = _float("HANDWRITING_PADDLE_KEEP", 0.55)

    htr_mod = None
    trocr_mod = None
    if _flag("HYBRID_OCR", "1") and _htr_enabled():
        try:
            import htr_latin as htr_mod
        except ImportError:
            htr_mod = None
            log.warning("htr_latin import failed")
    if _flag("HYBRID_OCR", "1") and _trocr_enabled():
        try:
            import trocr_onnx as trocr_mod
        except ImportError:
            trocr_mod = None
    elif _flag("HYBRID_OCR", "1") and not _htr_enabled() and not _trocr_enabled():
        log.debug("No HW recognizer — Paddle + ro_post only")

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

        want_hw_rec = False
        if photo:
            # Phone / notebook: HTR on HW (and weak printed).
            if style == "handwritten" and paddle_conf < hw_paddle_keep:
                want_hw_rec = True
            elif style == "printed" and paddle_conf < printed_fallback:
                want_hw_rec = True
        else:
            # PDF / flat scan: stay on Paddle — HTR is overconfident on print.
            # Optional English TrOCR only if explicitly enabled (experiments).
            if (
                trocr_mod
                and style == "handwritten"
                and paddle_conf < hw_paddle_keep
            ):
                want_hw_rec = True
            elif (
                trocr_mod
                and style == "printed"
                and paddle_conf < printed_fallback
            ):
                want_hw_rec = True

        used_alt = False
        htr_ready = htr_mod is not None and htr_mod.available()
        if want_hw_rec and htr_ready:
            hr = htr_mod.recognize_crop(crop)
            stats.htr_loaded = True
            if hr is not None and (hr.text or "").strip():
                tlen = len(hr.text.strip())
                take_htr = hr.conf >= hw_threshold and tlen >= hw_min_len
                # Free EasyOCR latin is print-biased: don't overwrite a crop where
                # Paddle already read a code/plate/date and HTR lost it.
                if take_htr and paddle_text.strip():
                    p_sig = logistics_signal(paddle_text)
                    h_sig = logistics_signal(hr.text)
                    if p_sig > 0 and h_sig < p_sig:
                        take_htr = False
                if take_htr:
                    text, conf = hr.text, hr.conf
                    source = "htr_latin"
                    stats.htr_latin_boxes += 1
                    used_alt = True
                elif paddle_text.strip():
                    source = "paddle_fallback"
                    stats.paddle_fallback_boxes += 1
                    used_alt = True
                else:
                    text, conf = hr.text, hr.conf
                    source = "htr_latin"
                    stats.htr_latin_boxes += 1
                    used_alt = True
            elif paddle_text.strip():
                source = "paddle_fallback"
                stats.paddle_fallback_boxes += 1
                used_alt = True

        trocr_ready = trocr_mod is not None and trocr_mod.available()
        if want_hw_rec and not used_alt and trocr_ready:
            tr = trocr_mod.recognize_crop(crop)
            stats.trocr_loaded = True
            if tr is not None and tr.text.strip():
                tlen = len(tr.text.strip())
                if trocr_looks_english_junk(tr.text):
                    log.debug("reject English TrOCR junk: %r", tr.text[:60])
                    text, conf = paddle_text, paddle_conf
                    source = "paddle_fallback"
                    stats.paddle_fallback_boxes += 1
                elif tr.conf >= max(hw_threshold, 0.75) and tlen >= hw_min_len:
                    text, conf = tr.text, tr.conf
                    source = "trocr"
                    stats.trocr_boxes += 1
                else:
                    text, conf = paddle_text, paddle_conf
                    source = "paddle_fallback"
                    stats.paddle_fallback_boxes += 1
            elif paddle_text.strip():
                source = "paddle_fallback"
                stats.paddle_fallback_boxes += 1
            else:
                stats.trocr_boxes += 1
            used_alt = True

        if not used_alt:
            if want_hw_rec and not htr_ready and not trocr_ready:
                log.debug("HW recognizer unavailable — paddle on crop")
            stats.paddle_boxes += 1

        if not (text or "").strip():
            continue
        text = normalize_ro_line(text)
        if not text.strip():
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

    if htr_mod is not None and _flag("HTR_UNLOAD_AFTER_REQUEST", "1"):
        try:
            htr_mod.unload()
        except Exception:  # noqa: BLE001
            pass
    if trocr_mod is not None and _flag("TROCR_UNLOAD_AFTER_REQUEST", "1"):
        try:
            trocr_mod.unload()
        except Exception:  # noqa: BLE001
            pass

    blob = "\n".join(ln.text for ln in lines)
    blob = normalize_ro_document(blob)
    # Re-sync line texts from document pass when line count matches roughly
    doc_lines = [ln for ln in blob.splitlines() if ln.strip()]
    if len(doc_lines) == len(lines):
        for ln, new_t in zip(lines, doc_lines):
            ln.text = new_t
    elif doc_lines:
        # Document stitch changed structure — rebuild lines, keep avg conf
        avg = (sum(ln.conf for ln in lines) / len(lines)) if lines else 0.5
        lines = [
            OcrLine(text=t, conf=avg, source="paddle", style="handwritten")
            for t in doc_lines
        ]

    confs = [ln.conf for ln in lines]
    check = check_fields(blob)
    if check.needs_review:
        _counters["needs_review_total"] += 1

    log.info(
        "hybrid photo=%s boxes=%s dropped=%s paddle=%s htr=%s trocr=%s fallback=%s ms=%.0f needs_review=%s missing=%s",
        photo,
        len(lines),
        stats.boxes_dropped,
        stats.paddle_boxes,
        stats.htr_latin_boxes,
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
