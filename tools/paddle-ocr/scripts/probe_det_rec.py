#!/usr/bin/env python3
"""GATE 1 — probe PaddleOCR 2.9 det/rec split paths A and B.

Always tests BOTH:
  A) engine.ocr(..., det=True, rec=False) then ocr(crop, det=False, rec=True)
  B) engine.text_detector / text_recognizer (or closest 2.9 API)

If both are flaky → exit non-zero (STOP — do not force the hybrid pipeline).

Run inside the paddle-ocr container (has Paddle + sample image) or on a host
with paddleocr installed:

  docker compose -f docker-compose.paddle-ocr.yml exec paddle-ocr \\
    python /app/scripts/probe_det_rec.py /data/sample.jpg

  # mount samples:
  docker compose -f docker-compose.paddle-ocr.yml run --rm \\
    -v \"%CD%/tools/paddle-ocr/samples:/data\" paddle-ocr \\
    python /app/scripts/probe_det_rec.py /data/baseline-avize/Aviz\\ 1.pdf
"""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path


def _load_rgb(path: Path):
    import numpy as np
    from PIL import Image
    import io

    data = path.read_bytes()
    if data[:4] == b"%PDF":
        import fitz

        with fitz.open(stream=data, filetype="pdf") as doc:
            pix = doc[0].get_pixmap(dpi=150)
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    else:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    # modest size for probe speed
    w, h = img.size
    scale = min(1.0, 1200 / float(max(w, h)))
    if scale < 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))))
    return np.asarray(img)


def _crop_box(arr, box):
    import numpy as np

    pts = np.asarray(box, dtype="float32").reshape(-1, 2)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    x0, y0 = max(0, int(x0) - 2), max(0, int(y0) - 2)
    x1, y1 = min(arr.shape[1], int(x1) + 2), min(arr.shape[0], int(y1) + 2)
    if x1 <= x0 or y1 <= y0:
        return None
    return arr[y0:y1, x0:x1]


def _boxes_from_det_only(result) -> list:
    """Normalize det-only ocr() output to a list of 4-point boxes."""
    boxes = []
    if not result:
        return boxes
    page = result[0] if isinstance(result, list) else result
    if not page:
        return boxes
    for item in page:
        if item is None:
            continue
        # det-only often returns just the box polygon
        if hasattr(item, "reshape"):
            boxes.append(item)
            continue
        if isinstance(item, (list, tuple)) and len(item) >= 1:
            box = item[0] if isinstance(item[0], (list, tuple)) or hasattr(item[0], "reshape") else item
            boxes.append(box)
    return boxes


def path_a(engine, arr) -> dict:
    """ocr() flags: det then rec on crop."""
    info = {"path": "A_ocr_flags", "ok": False, "boxes": 0, "sample": None, "error": None}
    try:
        try:
            det = engine.ocr(arr, det=True, rec=False, cls=True)
        except TypeError:
            det = engine.ocr(arr, det=True, rec=False)
        boxes = _boxes_from_det_only(det)
        info["boxes"] = len(boxes)
        if not boxes:
            info["error"] = "no boxes from det-only"
            return info
        crop = _crop_box(arr, boxes[0])
        if crop is None or crop.size == 0:
            info["error"] = "empty crop"
            return info
        try:
            rec = engine.ocr(crop, det=False, rec=True)
        except TypeError:
            rec = engine.ocr(crop, det=False)
        # parse text
        text, conf = "", None
        if rec and isinstance(rec, list):
            page = rec[0] if rec and isinstance(rec[0], list) else rec
            for item in page or []:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    tp = item[1]
                    if isinstance(tp, (list, tuple)) and tp:
                        text = str(tp[0])
                        if len(tp) > 1:
                            try:
                                conf = float(tp[1])
                            except (TypeError, ValueError):
                                pass
                        break
                elif isinstance(item, dict) and "text" in item:
                    text = str(item["text"])
                    break
        info["sample"] = {"text": text, "conf": conf}
        info["ok"] = bool(text.strip())
        if not info["ok"]:
            info["error"] = "rec returned empty text"
    except Exception as exc:  # noqa: BLE001
        info["error"] = f"{type(exc).__name__}: {exc}"
        info["trace"] = traceback.format_exc(limit=4)
    return info


def path_b(engine, arr) -> dict:
    """text_detector + text_recognizer (or closest)."""
    info = {"path": "B_detector_recognizer", "ok": False, "boxes": 0, "sample": None, "error": None}
    try:
        det_fn = getattr(engine, "text_detector", None) or getattr(engine, "det", None)
        rec_fn = getattr(engine, "text_recognizer", None) or getattr(engine, "rec", None)
        if det_fn is None or rec_fn is None:
            # PaddleOCR 2.9 often exposes .text_detector as submodule object with __call__
            for name in ("text_detector", "ocr"):
                pass
            info["error"] = (
                f"missing detector/recognizer attrs; "
                f"dir has text_detector={hasattr(engine, 'text_detector')} "
                f"text_recognizer={hasattr(engine, 'text_recognizer')}"
            )
            # Try internal API used by some 2.x builds
            if hasattr(engine, "ocr") and hasattr(engine, "textline_orientation_predictor"):
                info["error"] += " (partial internals present)"
            return info

        dt_boxes, _ = None, None
        out = det_fn(arr)
        # common shapes: (boxes, elapse) or just boxes
        if isinstance(out, tuple) and len(out) >= 1:
            dt_boxes = out[0]
        else:
            dt_boxes = out
        boxes = list(dt_boxes) if dt_boxes is not None else []
        info["boxes"] = len(boxes)
        if not boxes:
            info["error"] = "detector returned no boxes"
            return info
        crop = _crop_box(arr, boxes[0])
        if crop is None:
            info["error"] = "empty crop"
            return info
        rec_out = rec_fn([crop])
        text, conf = "", None
        # recognizer often returns list of (text, conf) or [[(text, conf)]]
        flat = rec_out
        if isinstance(flat, tuple):
            flat = flat[0]
        if isinstance(flat, list) and flat:
            first = flat[0]
            if isinstance(first, (list, tuple)) and first and isinstance(first[0], (list, tuple)):
                first = first[0]
            if isinstance(first, (list, tuple)) and first:
                text = str(first[0])
                if len(first) > 1:
                    try:
                        conf = float(first[1])
                    except (TypeError, ValueError):
                        pass
        info["sample"] = {"text": text, "conf": conf}
        info["ok"] = bool(str(text).strip())
        if not info["ok"]:
            info["error"] = f"recognizer empty; raw={type(rec_out)}"
    except Exception as exc:  # noqa: BLE001
        info["error"] = f"{type(exc).__name__}: {exc}"
        info["trace"] = traceback.format_exc(limit=4)
    return info


def consistency(run_fn, engine, arr, rounds: int = 3) -> dict:
    results = [run_fn(engine, arr) for _ in range(rounds)]
    oks = [r["ok"] for r in results]
    box_counts = [r["boxes"] for r in results]
    return {
        "rounds": rounds,
        "all_ok": all(oks),
        "any_ok": any(oks),
        "ok_flags": oks,
        "box_counts": box_counts,
        "stable_boxes": len(set(box_counts)) == 1,
        "last": results[-1],
        "results": results,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: probe_det_rec.py <image-or-pdf>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    if not path.is_file():
        print(f"FAIL: not a file: {path}", file=sys.stderr)
        return 2

    # Reuse app.get_engine when available (same tuned kwargs as production).
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    try:
        import app as app_module

        engine = app_module.get_engine()
    except Exception:
        from paddleocr import PaddleOCR

        engine = PaddleOCR(
            use_angle_cls=True,
            lang=os.environ.get("PADDLE_OCR_LANG", "latin"),
            show_log=False,
        )

    arr = _load_rgb(path)
    print(f"image={path.name} shape={arr.shape}")

    a = consistency(path_a, engine, arr, rounds=3)
    b = consistency(path_b, engine, arr, rounds=3)

    def _show(label, c):
        print(f"\n=== {label} ===")
        print(f"  all_ok={c['all_ok']} any_ok={c['any_ok']} box_counts={c['box_counts']} stable={c['stable_boxes']}")
        last = c["last"]
        print(f"  sample={last.get('sample')} error={last.get('error')}")

    _show("PATH A (ocr det/rec flags)", a)
    _show("PATH B (text_detector + text_recognizer)", b)

    a_stable = a["all_ok"] and a["stable_boxes"]
    b_stable = b["all_ok"] and b["stable_boxes"]

    if a_stable or b_stable:
        chosen = "A" if a_stable else "B"
        if a_stable and b_stable:
            chosen = "B" if not a["stable_boxes"] else "A"
            # Prefer B when both OK but A historically flaky — still pick A if both fully stable
            chosen = "A" if a_stable else "B"
            if a_stable and b_stable:
                chosen = "A"  # flags path is simpler; B is backup
        print(f"\nCHOSEN_PATH={chosen}")
        print("GATE 1 PASS — at least one stable path")
        return 0

    if a["any_ok"] or b["any_ok"]:
        print("\nGATE 1 WARN — path works sometimes but is flaky")
        print("STOP: do not force hybrid pipeline on flaky foundation")
        return 4

    print("\nGATE 1 FAIL — both paths A and B failed")
    print("STOP: investigate paddleocr / latin_PP-OCRv3_mobile_rec version")
    return 5


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
