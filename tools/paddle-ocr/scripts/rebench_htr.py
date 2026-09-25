#!/usr/bin/env python3
"""Re-bench HW photos + Baumit PDF against local paddle-ocr sidecar."""

from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

URL = "http://127.0.0.1:8100/ocr"
HW = Path("/tmp/baseline-avize/HW")
PDF = Path("/tmp/baseline-avize") / "Aviz Baumit.pdf"

EN_JUNK = re.compile(
    r"help|wikipedia|click here|community portal|learn to edit|main page",
    re.I,
)
CODE = re.compile(r"\b(?:TPO|PSL|TRO)-\d{4,}", re.I)
PLATE = re.compile(
    r"\b(?:B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|"
    r"HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)"
    r"-\d{2,3}-[A-Z]{2,3}\b",
    re.I,
)
DATE = re.compile(r"\b\d{1,2}\.\d{1,2}\.20\d{2}\b")


def post(path: Path, photo: bool = True) -> dict:
    data = path.read_bytes()
    boundary = "----bound"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + data + (
        f"\r\n--{boundary}\r\n"
        f'Content-Disposition: form-data; name="photo"\r\n\r\n'
        f'{"1" if photo else "0"}\r\n'
        f"--{boundary}--\r\n"
    ).encode()
    req = urllib.request.Request(
        URL,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=300) as r:
        out = json.loads(r.read().decode("utf-8"))
    out["_ms"] = round((time.time() - t0) * 1000)
    return out


def main() -> None:
    results = []
    for p in sorted(HW.glob("*.jpg")):
        print("===", p.name, flush=True)
        try:
            r = post(p, photo=True)
        except Exception as e:  # noqa: BLE001
            print("ERR", e, flush=True)
            results.append({"name": p.name, "error": str(e)})
            continue
        text = r.get("text") or ""
        stats = r.get("stats") or {}
        codes = CODE.findall(text)
        plates = PLATE.findall(text)
        dates = DATE.findall(text)
        en = bool(EN_JUNK.search(text))
        print(
            f"  chars={len(text)} ms={r['_ms']} eng_junk={en} "
            f"codes={codes} plates={plates} dates={dates}",
            flush=True,
        )
        print(f"  stats={stats}", flush=True)
        print(f"  preview={text[:450].replace(chr(10), ' | ')}", flush=True)
        results.append(
            {
                "name": p.name,
                "chars": len(text),
                "ms": r["_ms"],
                "eng_junk": en,
                "codes": codes,
                "plates": plates,
                "dates": dates,
                "stats": stats,
                "needs_review": r.get("needs_review"),
                "missing": r.get("missing_fields"),
                "engine": r.get("engine"),
                "text": text,
            }
        )

    print("=== Baumit PDF", flush=True)
    r = post(PDF, photo=False)
    text = r.get("text") or ""
    print(
        f"  chars={len(text)} ms={r['_ms']} engine={r.get('engine')} stats={r.get('stats')}",
        flush=True,
    )
    print(f"  preview={text[:500].replace(chr(10), ' | ')}", flush=True)
    baumit = {
        "name": PDF.name,
        "chars": len(text),
        "ms": r["_ms"],
        "engine": r.get("engine"),
        "stats": r.get("stats"),
        "text": text,
        "has_baumit": bool(re.search(r"baumit", text, re.I)),
        "has_greutate": bool(re.search(r"greutate", text, re.I)),
        "eng_junk": bool(EN_JUNK.search(text)),
    }

    out = {"hw": results, "baumit": baumit}
    Path("/tmp/htr-rebench.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("WROTE /tmp/htr-rebench.json", flush=True)


if __name__ == "__main__":
    main()
