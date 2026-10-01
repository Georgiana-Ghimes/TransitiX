#!/usr/bin/env python3
"""Minimal Mistral OCR smoke test (Python SDK).

  pip install mistralai
  set MISTRAL_API_KEY=...
  python tools/mistral-ocr/test_ocr.py

Uses a public receipt image from the Mistral cookbook.
"""

from __future__ import annotations

import os
import sys


def main() -> int:
    key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not key:
        print("Set MISTRAL_API_KEY first.", file=sys.stderr)
        return 2
    try:
        from mistralai import Mistral
    except ImportError:
        print("pip install mistralai", file=sys.stderr)
        return 2

    client = Mistral(api_key=key)
    response = client.ocr.process(
        model="mistral-ocr-latest",
        document={
            "type": "image_url",
            "image_url": (
                "https://raw.githubusercontent.com/mistralai/cookbook/"
                "refs/heads/main/mistral/ocr/receipt.png"
            ),
        },
        include_image_base64=True,
        include_blocks=True,
        confidence_scores_granularity="block",
    )
    pages = getattr(response, "pages", None) or []
    if not pages:
        print("No pages in response", file=sys.stderr)
        return 1
    md = getattr(pages[0], "markdown", "") or ""
    print(md[:2000] if md else "(empty markdown)")
    print("---")
    print(f"pages={len(pages)} ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
