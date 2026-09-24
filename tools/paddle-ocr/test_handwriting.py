#!/usr/bin/env python3
"""POST an image to the hybrid sidecar and print per-line source (paddle vs trocr).

  python test_handwriting.py path/to/photo.jpg
  python test_handwriting.py path/to/photo.jpg --url http://127.0.0.1:8100
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.request
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image", type=Path)
    ap.add_argument("--url", default="http://127.0.0.1:8100")
    ap.add_argument("--timeout", type=float, default=300.0)
    args = ap.parse_args()
    if not args.image.is_file():
        print(f"FAIL: {args.image}", file=sys.stderr)
        return 2

    data = args.image.read_bytes()
    mime = "application/pdf" if args.image.suffix.lower() == ".pdf" else "image/jpeg"
    body = json.dumps(
        {"image_base64": base64.b64encode(data).decode("ascii"), "mime_type": mime}
    ).encode()
    req = urllib.request.Request(
        f"{args.url.rstrip('/')}/ocr/json",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=args.timeout) as resp:
        payload = json.loads(resp.read().decode())

    print(f"engine={payload.get('engine')} hybrid_stats={payload.get('stats')}")
    print(f"avg_confidence={payload.get('avg_confidence')} needs_review={payload.get('needs_review')}")
    print(f"missing_fields={payload.get('missing_fields')}")
    lines = payload.get("lines") or []
    if not lines:
        print("(no per-line source — hybrid may be off or empty)")
        print(payload.get("text", "")[:500])
        return 0
    for i, ln in enumerate(lines, 1):
        print(
            f"{i:3}. [{ln.get('source'):16}] [{ln.get('style'):11}] "
            f"conf={float(ln.get('conf') or 0):.2f}  {ln.get('text')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
