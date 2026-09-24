#!/usr/bin/env python3
"""GATE 0 — baseline OCR on a frozen folder of client/mock avize (no hybrid).

Posts each file to the existing sidecar POST /ocr/json, runs field_check, and
writes samples/baseline-report.json (gitignored under samples/).

Usage (sidecar must be up on OCR_URL, default http://127.0.0.1:8100):

  python bench_baseline.py
  python bench_baseline.py --dir samples/baseline-avize --url http://127.0.0.1:8100
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from field_check import check_fields

ROOT = Path(__file__).resolve().parent
DEFAULT_DIR = ROOT / "samples" / "baseline-avize"
DEFAULT_OUT = ROOT / "samples" / "baseline-report.json"
EXTS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def _post_ocr(url: str, data: bytes, mime: str, timeout: float) -> dict:
    body = json.dumps(
        {
            "image_base64": base64.b64encode(data).decode("ascii"),
            "mime_type": mime,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/ocr/json",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _mime_for(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
    }.get(ext, "application/octet-stream")


def main() -> int:
    ap = argparse.ArgumentParser(description="GATE 0 baseline OCR bench")
    ap.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--url", default="http://127.0.0.1:8100")
    ap.add_argument("--timeout", type=float, default=300.0)
    args = ap.parse_args()

    folder: Path = args.dir
    if not folder.is_dir():
        print(f"FAIL: folder missing: {folder}", file=sys.stderr)
        return 2

    files = sorted(
        [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in EXTS],
        key=lambda p: p.name.lower(),
    )
    if not files:
        print(f"FAIL: no images/PDFs in {folder}", file=sys.stderr)
        return 2

    # Health probe
    try:
        with urllib.request.urlopen(f"{args.url.rstrip('/')}/health", timeout=5) as r:
            health = json.loads(r.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL: sidecar not reachable at {args.url}: {exc}", file=sys.stderr)
        return 3

    print(f"sidecar ok={health.get('ok')} engine_loaded={health.get('engine_loaded')}")
    print(f"files={len(files)} dir={folder}")

    rows: list[dict] = []
    missing_counts: dict[str, int] = {}
    docs_with_missing = 0
    all_confs: list[float] = []

    for path in files:
        data = path.read_bytes()
        meta = {
            "name": path.name,
            "sha256_16": _sha256(path),
            "bytes": len(data),
        }
        t0 = time.perf_counter()
        try:
            payload = _post_ocr(args.url, data, _mime_for(path), args.timeout)
            err = None
        except Exception as exc:  # noqa: BLE001
            payload = {}
            err = str(exc)
        ms = int((time.perf_counter() - t0) * 1000)

        text = str(payload.get("text") or "")
        confs = payload.get("line_confidences") or payload.get("confidences") or []
        conf_list = []
        for c in confs:
            try:
                conf_list.append(float(c))
            except (TypeError, ValueError):
                pass
        avg_conf = (
            float(payload["avg_confidence"])
            if payload.get("avg_confidence") is not None
            else (sum(conf_list) / len(conf_list) if conf_list else None)
        )
        if conf_list:
            all_confs.extend(conf_list)
        elif avg_conf is not None:
            all_confs.append(avg_conf)

        check = check_fields(text)
        if check.missing_fields:
            docs_with_missing += 1
            for m in check.missing_fields:
                missing_counts[m] = missing_counts.get(m, 0) + 1

        row = {
            **meta,
            "ms": ms,
            "chars": len(text),
            "pages": payload.get("pages"),
            "rotation": payload.get("rotation"),
            "avg_confidence": avg_conf,
            "line_confidences": conf_list,
            "needs_review": check.needs_review,
            "missing_fields": check.missing_fields,
            "found_fields": check.found,
            "error": err,
            "text_preview": text[:240].replace("\n", " | "),
        }
        rows.append(row)
        status = "ERR" if err else ("REVIEW" if check.needs_review else "ok")
        conf_s = f"{avg_conf:.2f}" if avg_conf is not None else "n/a"
        print(
            f"  [{status}] {path.name}  ms={ms} chars={len(text)} "
            f"conf={conf_s} missing={check.missing_fields or '-'}"
        )

    report = {
        "gate": 0,
        "hybrid": False,
        "url": args.url,
        "dir": str(folder),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "file_count": len(files),
        "files": [{"name": r["name"], "sha256_16": r["sha256_16"]} for r in rows],
        "summary": {
            "docs_with_missing": docs_with_missing,
            "pct_docs_with_missing": round(100.0 * docs_with_missing / len(files), 1),
            "missing_field_counts": dict(sorted(missing_counts.items(), key=lambda kv: -kv[1])),
            "avg_confidence_all_lines": (
                round(sum(all_confs) / len(all_confs), 4) if all_confs else None
            ),
            "confidence_count": len(all_confs),
            "note": (
                "Confidences require sidecar line_confidences/avg_confidence "
                "(additive on existing Paddle path). Empty = older sidecar."
            ),
        },
        "documents": rows,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {args.out}")
    print(
        f"summary: {docs_with_missing}/{len(files)} docs with missing fields "
        f"({report['summary']['pct_docs_with_missing']}%), "
        f"avg_conf={report['summary']['avg_confidence_all_lines']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
