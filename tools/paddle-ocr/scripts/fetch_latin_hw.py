#!/usr/bin/env python3
"""Fetch free (Apache-2.0) Latin CRNN-CTC ONNX into OCR_ONNX_DIR.

Source: EasyOCR latin_g2 via sceptre ONNX export
  https://huggingface.co/xberg-io/sceptre-latin_g2
Upstream weights: JaidedAI/EasyOCR (Apache-2.0).

Writes:
  latin-g2-free.onnx
  latin-g2-free.dict.txt   (one char per line; CTC blank = class 0, not in file)
  latin-g2-free.sha256

Usage:
  python scripts/fetch_latin_hw.py
  OCR_ONNX_DIR=/root/.paddleocr/onnx python scripts/fetch_latin_hw.py
"""

from __future__ import annotations

import hashlib
import os
import sys
import urllib.request
from pathlib import Path

# Exact character string from EasyOCR config.py latin_g2['characters']
# (blank is CTC class 0 — not listed here). Includes RO ĂăÂâÎîȘșȚț.
_LATIN_G2_CHARS = (
    " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`"
    "abcdefghijklmnopqrstuvwxyz{|}~ªÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß"
    "àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćČčĎďĐđĒēĖėĘęĚěĞğĨĩĪīĮįİı"
    "ĶķĹĺĻļĽľŁłŃńŅņŇňŒœŔŕŘřŚśŞşŠšŤťŨũŪūŮůŲųŸŹźŻżŽžƏƠơƯưȘșȚțə̇"
    "ḌḍḶḷṀṁṂṃṄṅṆṇṬṭẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊị"
    "ỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ€"
)

HF_ONNX = (
    "https://huggingface.co/xberg-io/sceptre-latin_g2/resolve/main/latin_g2.onnx"
)
LOCAL_ONNX = "latin-g2-free.onnx"
LOCAL_DICT = "latin-g2-free.dict.txt"
LOCAL_SHA = "latin-g2-free.sha256"


def main() -> int:
    out_dir = Path(
        os.environ.get(
            "OCR_ONNX_DIR",
            Path.home() / ".paddleocr" / "onnx",
        )
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"OCR_ONNX_DIR={out_dir}")
    print("License: Apache-2.0 (EasyOCR / sceptre) — free for commercial use")

    dest = out_dir / LOCAL_ONNX
    print(f"GET {HF_ONNX} -> {dest}")
    try:
        urllib.request.urlretrieve(HF_ONNX, dest)
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL download onnx: {exc}", file=sys.stderr)
        return 2

    dict_path = out_dir / LOCAL_DICT
    dict_path.write_text("\n".join(_LATIN_G2_CHARS) + "\n", encoding="utf-8")
    print(f"dict chars={len(_LATIN_G2_CHARS)} (+ blank class 0) -> {dict_path}")

    h = hashlib.sha256()
    h.update(dest.read_bytes())
    h.update(dict_path.read_bytes())
    sha_path = out_dir / LOCAL_SHA
    sha_path.write_text(h.hexdigest() + "\n", encoding="utf-8")
    print(f"  {LOCAL_ONNX}: {dest.stat().st_size} bytes")
    print(f"sha256 -> {sha_path}")
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
