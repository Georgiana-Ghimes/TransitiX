#!/usr/bin/env python3
"""
Translate the Roadnet operations screencapture PDF (PT → RO), keeping page images.

Input:  docs/officialRoadnetManual/screencapture-*.pdf  (image-only pages)
Output: docs/officialRoadnetManual/Manual-Roadnet-Ghid-Operatiuni-RO.pdf

Each output page: original screenshot + Romanian OCR transcript below.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import pymupdf
from deep_translator import GoogleTranslator
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image as RLImage
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "_work"
PAGES = WORK / "pages"
TEXT = WORK / "text"
CACHE = WORK / "translations.json"
TESS = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
TESSDATA = WORK / "tessdata"

OUT_PDF = ROOT / "Manual-Roadnet-Ghid-Operatiuni-RO.pdf"


def find_source_pdf() -> Path:
    cands = sorted(ROOT.glob("screencapture*.pdf"))
    if not cands:
        raise SystemExit(f"No screencapture PDF in {ROOT}")
    return cands[0]


def ensure_dirs() -> None:
    for d in (WORK, PAGES, TEXT, TESSDATA):
        d.mkdir(parents=True, exist_ok=True)
    # Prefer project-local tessdata; fall back to known installs.
    eng = Path(r"C:\Program Files\Tesseract-OCR\tessdata\eng.traineddata")
    por_candidates = [
        TESSDATA / "por.traineddata",
        Path(os.environ.get("LOCALAPPDATA", "")) / "tesseract" / "tessdata" / "por.traineddata",
        Path(r"C:\Program Files\Tesseract-OCR\tessdata\por.traineddata"),
    ]
    if eng.exists() and not (TESSDATA / "eng.traineddata").exists():
        (TESSDATA / "eng.traineddata").write_bytes(eng.read_bytes())
    for por in por_candidates:
        if por.exists():
            if por.resolve() != (TESSDATA / "por.traineddata").resolve():
                (TESSDATA / "por.traineddata").write_bytes(por.read_bytes())
            break
    if not (TESSDATA / "por.traineddata").exists():
        raise SystemExit(
            "Missing Portuguese OCR data (por.traineddata). "
            "Download from https://github.com/tesseract-ocr/tessdata and place in "
            f"{TESSDATA}"
        )
    if not TESS.exists():
        raise SystemExit(f"Tesseract not found at {TESS}")


def extract_page_image(doc: pymupdf.Document, page_index: int, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    page = doc[page_index]
    info = page.get_image_info(xrefs=True)
    if not info:
        # fallback: render page
        pix = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5))
        dest.write_bytes(pix.tobytes("jpeg"))
        return dest
    xref = info[0]["xref"]
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha > 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    # JPEG keeps size manageable
    dest_jpg = dest.with_suffix(".jpg")
    pix.save(dest_jpg)
    return dest_jpg


def ocr_image(image_path: Path, out_txt: Path) -> str:
    if out_txt.exists() and out_txt.stat().st_size > 0:
        return out_txt.read_text(encoding="utf-8", errors="replace")
    env = os.environ.copy()
    env["TESSDATA_PREFIX"] = str(TESSDATA)
    # Portuguese primary; English helps with UI chrome
    cmd = [
        str(TESS),
        str(image_path),
        "stdout",
        "-l",
        "por+eng",
        "--psm",
        "6",
    ]
    proc = subprocess.run(cmd, capture_output=True, env=env, check=False)
    text = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
    if proc.returncode != 0 and not text:
        err = (proc.stderr or b"").decode("utf-8", errors="replace")
        raise RuntimeError(f"OCR failed for {image_path.name}: {err}")
    out_txt.write_text(text + "\n", encoding="utf-8")
    return text


def clean_ocr(text: str) -> str:
    text = text.replace("\x0c", "")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    return "\n".join(lines)


def chunk_text(text: str, limit: int = 4200) -> list[str]:
    if len(text) <= limit:
        return [text] if text.strip() else []
    chunks: list[str] = []
    buf: list[str] = []
    size = 0
    for line in text.splitlines():
        add = len(line) + 1
        if size + add > limit and buf:
            chunks.append("\n".join(buf))
            buf, size = [], 0
        buf.append(line)
        size += add
    if buf:
        chunks.append("\n".join(buf))
    return chunks


def translate_pt_ro(text: str, cache: dict[str, str]) -> str:
    text = clean_ocr(text)
    if not text.strip():
        return ""
    if text in cache:
        return cache[text]
    translator = GoogleTranslator(source="pt", target="ro")
    parts = []
    for chunk in chunk_text(text):
        for attempt in range(4):
            try:
                parts.append(translator.translate(chunk))
                break
            except Exception as exc:  # noqa: BLE001
                if attempt == 3:
                    parts.append(f"[Traducere eșuată: {exc}]\n{chunk}")
                else:
                    time.sleep(1.5 * (attempt + 1))
    result = "\n".join(p for p in parts if p)
    cache[text] = result
    return result


def load_cache() -> dict[str, str]:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict[str, str]) -> None:
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")


def build_pdf(pages: list[tuple[Path, str]], title: str) -> None:
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ROTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=20,
        spaceAfter=8,
    )
    meta_style = ParagraphStyle(
        "ROMeta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor="#444444",
        spaceAfter=10,
    )
    body_style = ParagraphStyle(
        "ROBody",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        spaceAfter=4,
    )
    note_style = ParagraphStyle(
        "RONote",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=8,
        leading=10,
        textColor="#666666",
        spaceAfter=8,
    )

    doc = SimpleDocTemplate(
        str(OUT_PDF),
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title=title,
        author="Transitix — traducere automată",
    )
    story = []
    story.append(Paragraph("Manual Roadnet — Ghid de operațiuni (RO)", title_style))
    story.append(
        Paragraph(
            "Traducere automată din portugheză (OCR + traducere). "
            "Imaginile sunt capturile originale din manualul oficial. "
            "Textul OCR pe interfețe poate avea greșeli; verificați ecranele vizuale.",
            meta_style,
        )
    )
    story.append(PageBreak())

    max_w = A4[0] - 28 * mm
    max_h = A4[1] * 0.58

    for i, (img_path, ro_text) in enumerate(pages, start=1):
        story.append(Paragraph(f"Pagina {i} / {len(pages)}", meta_style))
        story.append(
            Paragraph(
                "Captură originală (portugheză) — păstrată pentru referință vizuală.",
                note_style,
            )
        )
        img = RLImage(str(img_path))
        iw, ih = float(img.imageWidth), float(img.imageHeight)
        scale = min(max_w / iw, max_h / ih, 1.0)
        img.drawWidth = iw * scale
        img.drawHeight = ih * scale
        story.append(img)
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph("Traducere în română (text extras din captură):", note_style))
        if ro_text.strip():
            for para in re.split(r"\n{2,}", ro_text):
                safe = (
                    para.replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace("\n", "<br/>")
                )
                if safe.strip():
                    story.append(Paragraph(safe, body_style))
        else:
            story.append(Paragraph("(Fără text detectat pe această pagină.)", body_style))
        story.append(PageBreak())
        if i % 25 == 0:
            print(f"  layout… {i}/{len(pages)}", flush=True)

    print(f"Writing {OUT_PDF.name}…", flush=True)
    doc.build(story)


def main() -> None:
    only = None
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        only = int(sys.argv[1])

    ensure_dirs()
    src = find_source_pdf()
    print(f"Source: {src.name}", flush=True)
    doc = pymupdf.open(src)
    n = doc.page_count if only is None else min(only, doc.page_count)
    print(f"Pages to process: {n} / {doc.page_count}", flush=True)

    cache = load_cache()
    pages: list[tuple[Path, str]] = []

    for i in range(n):
        img_path = PAGES / f"page-{i+1:04d}.jpg"
        txt_path = TEXT / f"page-{i+1:04d}.pt.txt"
        ro_path = TEXT / f"page-{i+1:04d}.ro.txt"
        print(f"[{i+1}/{n}] extract…", flush=True)
        img = extract_page_image(doc, i, img_path)
        print(f"[{i+1}/{n}] OCR…", flush=True)
        pt = ocr_image(img, txt_path)
        if ro_path.exists() and ro_path.stat().st_size > 0:
            ro = ro_path.read_text(encoding="utf-8")
        else:
            print(f"[{i+1}/{n}] translate…", flush=True)
            ro = translate_pt_ro(pt, cache)
            ro_path.write_text(ro + "\n", encoding="utf-8")
            if i % 5 == 0:
                save_cache(cache)
        pages.append((img, ro))

    save_cache(cache)
    build_pdf(pages, "Manual Roadnet — Ghid de operațiuni (RO)")
    print(f"Done: {OUT_PDF}", flush=True)
    print(f"Size: {OUT_PDF.stat().st_size / (1024*1024):.1f} MB", flush=True)


if __name__ == "__main__":
    main()
