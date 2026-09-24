"""TrOCR-small handwriting recognition via ONNX (CPU, greedy decode).

Expects under OCR_ONNX_DIR (default ~/.paddleocr/onnx):
  trocr-small-handwritten-v1-encoder.onnx
  trocr-small-handwritten-v1-decoder.onnx
  tokenizer.json  (BPE — required; without it decode cannot produce text)

Wide crops (aspect > 10:1) are split along width, recognized, and joined.
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from typing import Any

import numpy as np

log = logging.getLogger("paddle-ocr.trocr")

_lock = threading.Lock()
_encoder = None
_decoder = None
_tokenizer = None
_loaded_names: tuple[str, str] | None = None


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)) or default)
    except ValueError:
        return default


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


def _names() -> tuple[str, str, str]:
    base = os.environ.get("TROCR_ONNX", "trocr-small-handwritten-v1").strip()
    if base.endswith(".onnx"):
        base = base[: -len(".onnx")]
        if base.endswith("-encoder") or base.endswith("-decoder"):
            base = base.rsplit("-", 1)[0]
    enc = f"{base}-encoder.onnx"
    dec = f"{base}-decoder.onnx"
    tok = os.environ.get("TROCR_TOKENIZER", "tokenizer.json").strip()
    return enc, dec, tok


@dataclass
class TrocrResult:
    text: str
    conf: float
    backend: str


def available() -> bool:
    d = _model_dir()
    enc, dec, tok = _names()
    return all(
        os.path.isfile(os.path.join(d, n))
        for n in (enc, dec, tok)
    )


def unload() -> None:
    """Drop sessions to free RSS (MEMORY_PROFILE / TROCR_UNLOAD_AFTER_REQUEST)."""
    global _encoder, _decoder, _tokenizer, _loaded_names
    with _lock:
        _encoder = None
        _decoder = None
        _tokenizer = None
        _loaded_names = None
        log.info("TrOCR ONNX unloaded")


def _ensure_loaded() -> bool:
    global _encoder, _decoder, _tokenizer, _loaded_names
    if not available():
        return False
    d = _model_dir()
    enc_n, dec_n, tok_n = _names()
    enc_p, dec_p, tok_p = (os.path.join(d, enc_n), os.path.join(d, dec_n), os.path.join(d, tok_n))
    key = (enc_p, dec_p)
    with _lock:
        if _encoder is not None and _loaded_names == key:
            return True
        try:
            import onnxruntime as ort
            from tokenizers import Tokenizer
        except ImportError as exc:
            log.warning("TrOCR deps missing: %s", exc)
            return False

        opts = ort.SessionOptions()
        threads = _env_int("ORT_INTRA_THREADS", 2)
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        providers = ["CPUExecutionProvider"]
        log.info("Loading TrOCR ONNX enc=%s dec=%s tok=%s threads=%s", enc_n, dec_n, tok_n, threads)
        _encoder = ort.InferenceSession(enc_p, opts, providers=providers)
        _decoder = ort.InferenceSession(dec_p, opts, providers=providers)
        _tokenizer = Tokenizer.from_file(tok_p)
        _loaded_names = key
        return True


def _pad384(crop_rgb: np.ndarray) -> np.ndarray:
    """Resize preserving aspect + pad to 384x384 (no stretch)."""
    import cv2

    h, w = crop_rgb.shape[:2]
    if h < 1 or w < 1:
        return np.ones((384, 384, 3), dtype=np.uint8) * 255
    scale = min(384 / float(h), 384 / float(w))
    nh, nw = max(1, int(round(h * scale))), max(1, int(round(w * scale)))
    resized = cv2.resize(crop_rgb, (nw, nh), interpolation=cv2.INTER_CUBIC)
    canvas = np.ones((384, 384, 3), dtype=np.uint8) * 255
    y0 = (384 - nh) // 2
    x0 = (384 - nw) // 2
    canvas[y0 : y0 + nh, x0 : x0 + nw] = resized
    return canvas


def _split_wide(crop_rgb: np.ndarray) -> list[np.ndarray]:
    """Split aspect > 10:1 into shorter strips (ruta/adresa)."""
    h, w = crop_rgb.shape[:2]
    if h < 1:
        return [crop_rgb]
    aspect = w / float(h)
    if aspect <= 10.0:
        return [crop_rgb]
    # Target aspect ~6:1 per chunk
    chunk_w = max(h * 6, 64)
    chunks = []
    x = 0
    overlap = max(8, h // 4)
    while x < w:
        x1 = min(w, int(x + chunk_w))
        chunks.append(crop_rgb[:, x:x1])
        if x1 >= w:
            break
        x = x1 - overlap
    return chunks or [crop_rgb]


def _preprocess_pixel_values(crop_rgb: np.ndarray) -> np.ndarray:
    """ViT-style normalize to NCHW float32."""
    img = _pad384(crop_rgb).astype(np.float32) / 255.0
    # ImageNet-ish means used by TrOCR processor
    mean = np.array([0.5, 0.5, 0.5], dtype=np.float32).reshape(1, 1, 3)
    std = np.array([0.5, 0.5, 0.5], dtype=np.float32).reshape(1, 1, 3)
    img = (img - mean) / std
    return np.transpose(img, (2, 0, 1))[None, ...].astype(np.float32)


def _greedy_decode(pixel_values: np.ndarray) -> tuple[str, float]:
    """Greedy decode (ONNX has no easy beam search — acceptable for demo)."""
    assert _encoder is not None and _decoder is not None and _tokenizer is not None

    enc_inputs = {_encoder.get_inputs()[0].name: pixel_values}
    enc_out = _encoder.run(None, enc_inputs)
    encoder_hidden = enc_out[0]

    # TrOCR-small: decoder_start_token_id=2, eos=2, bos=0, pad=1 (HF config).
    # Do NOT use tokenizer <s> — that is often 0 and breaks greedy start.
    bos_id = _env_int("TROCR_DECODER_START", 2)
    eos_id = _env_int("TROCR_EOS", 2)

    max_len = _env_int("TROCR_MAX_LEN", 64)
    input_ids = np.array([[bos_id]], dtype=np.int64)
    confs: list[float] = []
    generated: list[int] = []

    dec_input_names = [i.name for i in _decoder.get_inputs()]

    for _ in range(max_len):
        feed: dict[str, Any] = {}
        # Common export names
        for name, val in (
            ("input_ids", input_ids),
            ("encoder_hidden_states", encoder_hidden),
            ("encoder_outputs", encoder_hidden),
        ):
            if name in dec_input_names:
                feed[name] = val
        # positional fallback by order
        if not feed:
            feed[dec_input_names[0]] = input_ids
            if len(dec_input_names) > 1:
                feed[dec_input_names[1]] = encoder_hidden

        logits = _decoder.run(None, feed)[0]  # [1, seq, vocab]
        next_logits = logits[0, -1, :]
        # softmax confidence of argmax
        m = float(next_logits.max())
        exp = np.exp(next_logits - m)
        probs = exp / exp.sum()
        next_id = int(np.argmax(probs))
        confs.append(float(probs[next_id]))
        if next_id == eos_id:
            break
        generated.append(next_id)
        input_ids = np.concatenate(
            [input_ids, np.array([[next_id]], dtype=np.int64)], axis=1
        )

    text = _tokenizer.decode(generated, skip_special_tokens=True).strip()
    conf = float(sum(confs) / len(confs)) if confs else 0.0
    return text, conf


def recognize_crop(crop_rgb: np.ndarray) -> TrocrResult | None:
    """Run TrOCR on one RGB crop. Returns None if models unavailable."""
    if crop_rgb is None or crop_rgb.size == 0:
        return TrocrResult("", 0.0, "trocr")
    if not _ensure_loaded():
        return None

    pieces = _split_wide(crop_rgb)
    texts: list[str] = []
    confs: list[float] = []
    for piece in pieces:
        pv = _preprocess_pixel_values(piece)
        try:
            t, c = _greedy_decode(pv)
        except Exception as exc:  # noqa: BLE001
            log.warning("TrOCR decode failed: %s", exc)
            continue
        if t:
            texts.append(t)
            confs.append(c)
    if not texts:
        return TrocrResult("", 0.0, "trocr")
    return TrocrResult(
        " ".join(texts).strip(),
        float(sum(confs) / len(confs)),
        "trocr",
    )
