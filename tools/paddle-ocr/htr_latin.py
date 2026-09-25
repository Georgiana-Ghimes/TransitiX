"""Latin-extended text recognition (CRNN-CTC ONNX) — Apache-2.0.

Model: EasyOCR latin_g2 via xberg-io/sceptre-latin_g2 (Apache-2.0).
Charset includes Latin-extended diacritics (ăâîșț / ȘșȚț) — RO-ready.
Replaces the previous PolyForm Noncommercial handwriting checkpoint.

Expects under OCR_ONNX_DIR:
  latin-g2-free.onnx
  latin-g2-free.dict.txt

Input tensor [1, 1, 64, W]: grayscale height 64, (px/255-0.5)/0.5, dynamic width.
CTC blank = class 0; dict lines are classes 1..N.
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass

import numpy as np

log = logging.getLogger("paddle-ocr.htr-latin")

_lock = threading.Lock()
_session = None
_charset: list[str] | None = None  # index 0 unused conceptually; decode uses blank=0
_loaded_path: str | None = None


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)) or default)
    except ValueError:
        return default


def _model_dir() -> str:
    return os.environ.get(
        "OCR_ONNX_DIR",
        os.path.join(os.path.expanduser("~"), ".paddleocr", "onnx"),
    )


def _names() -> tuple[str, str]:
    base = os.environ.get("HTR_ONNX", "latin-g2-free").strip()
    if base.endswith(".onnx"):
        base = base[: -len(".onnx")]
    onnx = f"{base}.onnx"
    dictionary = os.environ.get("HTR_DICT", f"{base}.dict.txt").strip()
    return onnx, dictionary


def available() -> bool:
    d = _model_dir()
    onnx, dictionary = _names()
    return all(os.path.isfile(os.path.join(d, n)) for n in (onnx, dictionary))


def unload() -> None:
    global _session, _charset, _loaded_path
    with _lock:
        _session = None
        _charset = None
        _loaded_path = None
        log.info("HTR latin ONNX unloaded")


def _load_charset(path: str) -> list[str]:
    """One character per line = CTC classes 1..N (class 0 is blank)."""
    chars: list[str] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            raw = line.rstrip("\n\r")
            if raw == "":
                chars.append(" ")
            else:
                chars.append(raw[0])
    return chars


def _ensure_loaded() -> bool:
    global _session, _charset, _loaded_path
    if not available():
        return False
    d = _model_dir()
    onnx_n, dict_n = _names()
    onnx_p = os.path.join(d, onnx_n)
    dict_p = os.path.join(d, dict_n)
    with _lock:
        if _session is not None and _loaded_path == onnx_p:
            return True
        try:
            import onnxruntime as ort
        except ImportError as exc:
            log.warning("onnxruntime missing for HTR: %s", exc)
            return False
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = _env_int("ORT_INTRA_THREADS", 2)
        opts.inter_op_num_threads = 1
        log.info("Loading free latin ONNX %s dict=%s (Apache-2.0)", onnx_n, dict_n)
        _session = ort.InferenceSession(onnx_p, opts, providers=["CPUExecutionProvider"])
        _charset = _load_charset(dict_p)
        _loaded_path = onnx_p
        # Output classes should be len(charset)+1 (blank)
        out_shape = _session.get_outputs()[0].shape
        log.info("HTR charset size=%s blank=0 out_shape=%s", len(_charset), out_shape)
        return True


@dataclass
class HtrResult:
    text: str
    conf: float
    backend: str = "htr_latin"


def _preprocess(crop_rgb: np.ndarray) -> np.ndarray:
    """[1,1,64,W] float32 — EasyOCR/sceptre contract."""
    import cv2

    h_fixed = 64
    if crop_rgb is None or crop_rgb.size == 0:
        return np.zeros((1, 1, h_fixed, h_fixed), dtype=np.float32)
    if crop_rgb.ndim == 3:
        gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    else:
        gray = crop_rgb
    inv = 255 - gray
    ys, xs = np.where(inv > 20)
    if len(xs) > 8 and len(ys) > 2:
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        pad = 2
        y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
        y1, x1 = min(gray.shape[0], y1 + pad), min(gray.shape[1], x1 + pad)
        gray = gray[y0:y1, x0:x1]
    h, w = gray.shape[:2]
    if h < 2 or w < 2:
        return np.zeros((1, 1, h_fixed, h_fixed), dtype=np.float32)
    scale = float(h_fixed) / float(h)
    nw = max(8, int(round(w * scale)))
    nw = min(nw, _env_int("HTR_MAX_WIDTH", 2048))
    resized = cv2.resize(gray, (nw, h_fixed), interpolation=cv2.INTER_AREA)
    # (pixel/255 - 0.5) / 0.5
    norm = (resized.astype(np.float32) / 255.0 - 0.5) / 0.5
    return norm[None, None, :, :].astype(np.float32)


def _ctc_greedy(logits: np.ndarray, charset: list[str]) -> tuple[str, float]:
    """logits: [T, C] or [1, T, C] — blank is class 0 (EasyOCR)."""
    if logits.ndim == 3:
        logits = logits[0]
    blank = 0
    m = logits.max(axis=1, keepdims=True)
    exp = np.exp(logits - m)
    probs = exp / exp.sum(axis=1, keepdims=True)
    ids = probs.argmax(axis=1)
    confs: list[float] = []
    out_ids: list[int] = []
    prev = blank
    for t, idx in enumerate(ids):
        idx = int(idx)
        if idx != blank and idx != prev:
            out_ids.append(idx)
            confs.append(float(probs[t, idx]))
        prev = idx
    chars: list[str] = []
    for idx in out_ids:
        # class i (i>=1) → charset[i-1]
        ci = idx - 1
        if 0 <= ci < len(charset):
            chars.append(charset[ci])
    text = "".join(chars).strip()
    conf = float(sum(confs) / len(confs)) if confs else 0.0
    return text, conf


def recognize_crop(crop_rgb: np.ndarray) -> HtrResult | None:
    """Run latin recognizer on one RGB crop. None if model unavailable."""
    if crop_rgb is None or crop_rgb.size == 0:
        return HtrResult("", 0.0)
    if not _ensure_loaded():
        return None
    assert _session is not None and _charset is not None
    inp = _preprocess(crop_rgb)
    in_name = _session.get_inputs()[0].name
    try:
        out = _session.run(None, {in_name: inp})[0]
    except Exception as exc:  # noqa: BLE001
        log.warning("HTR latin infer failed: %s", exc)
        return HtrResult("", 0.0)
    text, conf = _ctc_greedy(out, _charset)
    try:
        from ro_post import fold_cyrillic_lookalikes

        text = fold_cyrillic_lookalikes(text)
    except Exception:  # noqa: BLE001
        pass
    return HtrResult(text=text, conf=conf, backend="htr_latin")
