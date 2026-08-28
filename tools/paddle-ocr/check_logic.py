"""
Exercises everything in `app.py` except PaddleOCR itself.

The recognition engine is heavy — hundreds of megabytes and a model download — so on a machine
without it the page handling around it used to go unrun and unverified. This replaces
`ocr_array` with a double and checks the parts that decide what gets read: PDF rasterisation,
the page cap, what the response says it read, and the orientation search that only happens once.

    pip install fastapi pydantic python-multipart pymupdf pillow numpy
    python tools/paddle-ocr/check_logic.py

Inside the built container everything is already present, so it runs as-is:

    docker compose -f docker-compose.companion.yml exec paddle-ocr python /app/check_logic.py
"""
from __future__ import annotations

import asyncio
import base64
import importlib.util
import io
import logging
import os
import sys

import fitz  # PyMuPDF

HERE = os.path.dirname(os.path.abspath(__file__))
logging.disable(logging.INFO)

spec = importlib.util.spec_from_file_location("paddle_app", os.path.join(HERE, "app.py"))
app_module = importlib.util.module_from_spec(spec)
# pydantic resolves `from __future__ import annotations` against the module in sys.modules.
# Loading by path without this makes the request models look "not fully defined".
sys.modules["paddle_app"] = app_module
spec.loader.exec_module(app_module)

failures: list[str] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    print(("  PASS  " if passed else "  FAIL  ") + name + (f"   {detail}" if detail else ""))
    if not passed:
        failures.append(name)


def make_pdf(pages: int) -> bytes:
    """A portrait PDF with real text on every page."""
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_text((60, 80), f"AVIZ PSL-004436{i}  pagina {i + 1}", fontsize=18)
    data = doc.tobytes()
    doc.close()
    return data


calls: list[tuple[int, int]] = []


def stub_engine(reads_well_when_landscape: bool):
    """Stands in for PaddleOCR: readable text only in one orientation, so choices are visible."""
    def ocr_array(arr):
        height, width = arr.shape[0], arr.shape[1]
        calls.append((width, height))
        if (width > height) == reads_well_when_landscape:
            return "Aviz de expeditie PSL-0044362 greutate bruta 9964 kg transport", [0.95] * 12
        return "iiii", [0.2]
    return ocr_array


def main() -> int:
    print("import app.py: OK - nothing at import time needs paddle")

    app_module.ocr_array = stub_engine(False)

    pages, total = app_module.pages_from_bytes(make_pdf(3))
    check("a PDF is rasterised, one image per page", len(pages) == 3 and total == 3,
          f"pages={len(pages)} total={total}")
    check("the rasterised page is a usable image", pages[0].size[0] > 100, f"size={pages[0].size}")

    buf = io.BytesIO()
    pages[0].save(buf, format="PNG")
    single, single_total = app_module.pages_from_bytes(buf.getvalue())
    check("an image is one page and is not sent through fitz",
          len(single) == 1 and single_total == 1)

    capped, real_total = app_module.pages_from_bytes(make_pdf(6), max_pages=2)
    check("the cap limits how many pages are read", len(capped) == 2)
    # A partial read filed as the whole document understates a figure on an invoice.
    check("the true page count survives the cap", real_total == 6, f"total={real_total}")

    text, _rotation, read, total = app_module.run_ocr_on_bytes(make_pdf(6), max_pages=2)
    check("run_ocr_on_bytes returns (text, rotation, read, total)", (read, total) == (2, 6),
          f"read={read} total={total}")
    check("text from every page read is joined", text.count("PSL") >= 2, repr(text[:50]))

    # Orientation: page one searches, the rest reuse what won. Counted per page, because the
    # flat call list cannot say where one page ended and the next began.
    calls.clear()
    app_module.ocr_array = stub_engine(True)
    per_page: list[int] = []
    real_ocr_page = app_module.ocr_page

    def counting_ocr_page(image, prefer=None):
        before = len(calls)
        result = real_ocr_page(image, prefer=prefer)
        per_page.append(len(calls) - before)
        return result

    app_module.ocr_page = counting_ocr_page
    try:
        _text, rotation, _read, _total = app_module.run_ocr_on_bytes(make_pdf(3))
    finally:
        app_module.ocr_page = real_ocr_page

    check("the first page searches orientations", per_page[0] > 1, f"{per_page[0]} passes")
    check("later pages cost one pass each, not four",
          all(n == 1 for n in per_page[1:]), f"passes per page: {per_page}")
    check("the winning rotation is reported", rotation in (90, 270), f"rotation={rotation}")

    app_module.ocr_array = stub_engine(False)
    truncated = asyncio.run(app_module.ocr_json(app_module.OcrJsonRequest(
        image_base64=base64.b64encode(make_pdf(6)).decode(),
        mime_type="application/pdf",
        max_pages=2,
    )))
    check("the response says it read only part of the document",
          (truncated.pages, truncated.total_pages, truncated.truncated) == (2, 6, True),
          f"pages={truncated.pages} total={truncated.total_pages} truncated={truncated.truncated}")

    whole = asyncio.run(app_module.ocr_json(app_module.OcrJsonRequest(
        image_base64=base64.b64encode(make_pdf(2)).decode(),
        mime_type="application/pdf",
    )))
    check("nothing is flagged truncated when everything was read",
          whole.truncated is False and whole.total_pages == 2)

    print()
    if failures:
        print(f"FAILED: {len(failures)} - {', '.join(failures)}")
        return 1
    print("All checks passed (PaddleOCR itself is not exercised here).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
