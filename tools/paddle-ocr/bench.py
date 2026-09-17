"""
Measure what the OCR pipeline actually recovers, per preprocessing variant.

`check_logic.py` covers the pure logic offline; this needs the models, so it runs where the
sidecar runs:

    docker compose -f docker-compose.paddle-ocr.yml run --rm \
      paddle-ocr python bench.py sample-carnet.jpg

A folder works too, which is the point — one photo proves nothing about handwriting, and the
sample in this repo is a 576px copy, far smaller than what a driver's phone sends:

    docker compose -f docker-compose.paddle-ocr.yml run --rm \
      -v /path/to/real/photos:/data paddle-ocr python bench.py /data

Expected tokens turn "looks better" into a number. Either inline:

    BENCH_EXPECT=TPO-0025813,B-112-VFM,TRO-0008053 python bench.py sample-carnet.jpg

or, per photo, in a `<name>.expect.txt` next to it (one token per line, or comma-separated) —
which is how you build a fixture set worth re-running after every change.

`--sweep` re-runs the whole thing at several detector sizes. PaddleOCR caps the page's long side
at `det_limit_side_len` before detection, so that number decides whether handwriting is visible
at all, and it costs CPU roughly with its square. 1920 is a starting guess; measure it on the VM
that will actually run it.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import numpy as np

import app

_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".pdf"}

# Order is the order the service tries them in.
VARIANTS = (
    ("emphasize_ink", lambda im: app.emphasize_ink(im)),
    ("plain", lambda im: app.fit_for_detector(im)),
    ("shadow", lambda im: app.flatten_shadow(im)),
    ("clahe", lambda im: app.enhance_aggressive(im)),
    ("enhance", lambda im: app.enhance_for_ocr(im)),
)


def expected_tokens(path: Path) -> list[str]:
    """Tokens this photo should yield: a sidecar .expect.txt, else BENCH_EXPECT for the whole run."""
    sidecar = path.with_suffix(path.suffix + ".expect.txt")
    if not sidecar.exists():
        sidecar = path.with_suffix(".expect.txt")
    raw = sidecar.read_text(encoding="utf-8") if sidecar.exists() else os.environ.get("BENCH_EXPECT", "")
    return [t.strip() for t in raw.replace("\n", ",").split(",") if t.strip()]


def _squash(value: str) -> str:
    """Compare tokens without punctuation or spacing — `TPO-0025813` vs `TPO 0025813`."""
    return "".join(ch for ch in str(value).upper() if ch.isalnum())


def found_tokens(text: str, expected: list[str]) -> list[str]:
    blob = _squash(text)
    return [t for t in expected if _squash(t) in blob]


def collect(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    files = sorted(
        p for p in target.iterdir()
        if p.is_file() and p.suffix.lower() in _IMAGE_SUFFIXES and ".expect" not in p.name
    )
    return files


def reset_engine(side: int) -> None:
    """Detector size is fixed at construction, so a sweep has to rebuild the engine."""
    os.environ["PADDLE_OCR_DET_SIDE_LEN"] = str(side)
    app._DET_SIDE_LEN = side
    app._engine = None


def bench_one(path: Path, expected: list[str]) -> dict[str, dict]:
    data = path.read_bytes()
    pages, total = app.pages_from_bytes(data, 1)
    image = pages[0]
    print(f"\n=== {path.name}  {image.size[0]}x{image.size[1]}  (page 1 of {total})")
    if expected:
        print(f"    expecting {len(expected)} tokens: {', '.join(expected)}")

    try:
        warped = app.correct_perspective(image)
        note = "no page quad found — left as is" if warped.size == image.size else "warped"
        print(f"    perspective: {note} → {warped.size[0]}x{warped.size[1]}")
    except Exception as exc:  # noqa: BLE001
        print(f"    perspective: failed ({exc})")
        warped = image.convert("RGB")

    results: dict[str, dict] = {}
    for name, transform in VARIANTS:
        started = time.monotonic()
        try:
            frame = transform(warped)
            text, confs = app.ocr_array(np.array(frame))
        except Exception as exc:  # noqa: BLE001
            print(f"\n--- {name}: FAILED {exc}")
            results[name] = {"hits": 0, "seconds": time.monotonic() - started, "failed": True}
            continue

        seconds = time.monotonic() - started
        score = app._score_frame(text, confs, frame)
        avg = sum(confs) / len(confs) if confs else 0.0
        hits = found_tokens(text, expected)
        results[name] = {
            "hits": len(hits), "chars": len(text), "score": score,
            "conf": avg, "seconds": seconds, "failed": False,
        }

        print(f"\n--- {name}  {frame.size[0]}x{frame.size[1]}  {seconds:.1f}s  "
              f"score={score:.2f} lines={len(text.splitlines())} chars={len(text)} "
              f"avg_conf={avg:.2f}")
        if expected:
            missing = [t for t in expected if t not in hits]
            print(f"    tokens {len(hits)}/{len(expected)}"
                  + (f" — missing {', '.join(missing)}" if missing else " — all found"))
        print(text or "(nothing)")

    return results


def summarise(per_file: dict[str, dict[str, dict]], expected_total: int) -> None:
    if len(per_file) < 2 and expected_total == 0:
        return
    print("\n" + "=" * 72)
    print(f"{'variant':16s} {'tokens':>12s} {'chars':>9s} {'avg s':>8s} {'failures':>9s}")
    for name, _ in VARIANTS:
        rows = [r[name] for r in per_file.values() if name in r]
        if not rows:
            continue
        hits = sum(r.get("hits", 0) for r in rows)
        chars = sum(r.get("chars", 0) for r in rows)
        secs = sum(r.get("seconds", 0.0) for r in rows) / len(rows)
        fails = sum(1 for r in rows if r.get("failed"))
        token_col = f"{hits}/{expected_total}" if expected_total else "n/a"
        print(f"{name:16s} {token_col:>12s} {chars:>9d} {secs:>8.1f} {fails:>9d}")
    print("\nA variant earns its CPU by recovering tokens, not by producing more characters.")


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    flags = [a for a in argv[1:] if a.startswith("--")]
    if not args:
        print(__doc__)
        return 2

    target = Path(args[0])
    if not target.exists():
        print(f"not found: {target}")
        return 2

    files = collect(target)
    if not files:
        print(f"no images in {target}")
        return 2

    sweep = [app._DET_SIDE_LEN]
    for flag in flags:
        if flag.startswith("--sweep"):
            value = flag.split("=", 1)[1] if "=" in flag else "960,1440,1920,2560"
            sweep = [int(v) for v in value.split(",") if v.strip()]

    for side in sweep:
        if len(sweep) > 1:
            print("\n" + "#" * 72)
            print(f"# detector long side = {side} px"
                  + ("   (PaddleOCR's own default)" if side == 960 else ""))
            print("#" * 72)
            reset_engine(side)

        per_file: dict[str, dict[str, dict]] = {}
        expected_total = 0
        for path in files:
            expected = expected_tokens(path)
            expected_total += len(expected)
            per_file[path.name] = bench_one(path, expected)
        summarise(per_file, expected_total)

    if len(sweep) > 1:
        print("\nPick the smallest size that finds the tokens — the cost grows with its square, "
              "and the interactive budget is 120 s (OCR_INTERACTIVE_TIMEOUT_MS).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
