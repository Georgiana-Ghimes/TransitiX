"""
Roadnet operations guide: Portuguese screenshot PDF → Romanian PDF with images kept.

Source is a screencapture (no text layer). Each page is one JPEG. Pipeline:
  1. extract page image
  2. OCR (Tesseract, Portuguese)
  3. translate to Romanian (Google via deep-translator)
  4. rebuild PDF: original screenshot + Romanian transcript under it
"""
from __future__ import annotations

import argparse
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
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "_work"
PAGES = WORK / "pages"
TEXT = WORK / "text"
TESSDATA = WORK / "tessdata"
TESSERACT = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
PROGRESS = WORK / "progress.json"


def find_source_pdf() -> Path:
    candidates = sorted(ROOT.glob("screencapture*.pdf"))
    if not candidates:
        raise FileNotFoundError(f"No screencapture*.pdf in {ROOT}")
    return candidates[0]


def register_fonts() -> str:
    """Prefer a font that covers Romanian diacritics."""
    candidates = [
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path(r"C:\Windows\Fonts\calibri.ttf"),
        Path(r"C:\Windows\Fonts\segoeui.ttf"),
    ]
    for path in candidates:
        if path.exists():
            pdfmetrics.registerFont(TTFont("BodyRO", str(path)))
            return "BodyRO"
    return "Helvetica"


def extract_page_image(doc: pymupdf.Document, page_index: int, out_path: Path) -> Path:
    page = doc[page_index]
    info = page.get_image_info(xrefs=True)
    if not info:
        # fallback: render
        pix = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5))
        pix.save(str(out_path))
        return out_path
    xref = info[0]["xref"]
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha > 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    # JPEG keeps size manageable
    if out_path.suffix.lower() in {".jpg", ".jpeg"}:
        pix.pil_save(str(out_path), format="JPEG", quality=85)
    else:
        pix.save(str(out_path))
    return out_path


def ocr_image(image_path: Path) -> str:
    env = os.environ.copy()
    env["TESSDATA_PREFIX"] = str(TESSDATA)
    result = subprocess.run(
        [
            str(TESSERACT),
            str(image_path),
            "stdout",
            "-l",
            "por",
            "--psm",
            "6",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        check=False,
    )
    if result.returncode != 0 and not result.stdout.strip():
        raise RuntimeError(f"OCR failed on {image_path.name}: {result.stderr[:400]}")
    return clean_ocr(result.stdout)


def clean_ocr(text: str) -> str:
    text = text.replace("\x0c", "")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
    # drop tiny noise lines
    lines = [ln for ln in lines if ln and not re.fullmatch(r"[^\wĂÂÎȘȚăâîșț]+", ln)]
    return "\n".join(lines).strip()


def chunk_text(text: str, max_chars: int = 4200) -> list[str]:
    if len(text) <= max_chars:
        return [text] if text else []
    chunks: list[str] = []
    buf: list[str] = []
    size = 0
    for para in text.split("\n"):
        add = len(para) + 1
        if buf and size + add > max_chars:
            chunks.append("\n".join(buf))
            buf = [para]
            size = add
        else:
            buf.append(para)
            size += add
    if buf:
        chunks.append("\n".join(buf))
    return chunks


def translate_pt_to_ro(text: str, retries: int = 4) -> str:
    if not text.strip():
        return ""
    translator = GoogleTranslator(source="pt", target="ro")
    parts: list[str] = []
    for chunk in chunk_text(text):
        last_err = None
        for attempt in range(retries):
            try:
                parts.append(translator.translate(chunk))
                last_err = None
                break
            except Exception as exc:  # network / rate limit
                last_err = exc
                time.sleep(1.5 * (attempt + 1))
        if last_err is not None:
            parts.append(f"[Traducere eșuată pentru acest fragment]\n{chunk}")
        time.sleep(0.35)
    return "\n".join(parts)


def load_progress() -> dict:
    if PROGRESS.exists():
        return json.loads(PROGRESS.read_text(encoding="utf-8"))
    return {"done": {}}


def save_progress(data: dict) -> None:
    PROGRESS.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def process_pages(start: int, end: int | None, force: bool = False) -> None:
    PAGES.mkdir(parents=True, exist_ok=True)
    TEXT.mkdir(parents=True, exist_ok=True)
    src = find_source_pdf()
    doc = pymupdf.open(str(src))
    total = doc.page_count
    last = total if end is None else min(end, total)
    first = max(1, start)
    progress = load_progress()
    done = progress.setdefault("done", {})

    print(f"Source: {src.name} ({total} pages). Processing {first}..{last}")
    for page_no in range(first, last + 1):
        key = str(page_no)
        if key in done and not force:
            print(f"  [{page_no}/{last}] skip (cached)")
            continue
        idx = page_no - 1
        img_path = PAGES / f"page-{page_no:04d}.jpg"
        por_path = TEXT / f"page-{page_no:04d}.por.txt"
        ro_path = TEXT / f"page-{page_no:04d}.ro.txt"
        t0 = time.time()
        extract_page_image(doc, idx, img_path)
        por = ocr_image(img_path)
        por_path.write_text(por, encoding="utf-8")
        ro = translate_pt_to_ro(por)
        ro_path.write_text(ro, encoding="utf-8")
        done[key] = {
            "image": img_path.name,
            "chars_por": len(por),
            "chars_ro": len(ro),
            "seconds": round(time.time() - t0, 2),
        }
        save_progress(progress)
        print(
            f"  [{page_no}/{last}] OCR {len(por)}c -> RO {len(ro)}c "
            f"in {done[key]['seconds']}s",
            flush=True,
        )
    doc.close()


def escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def build_pdf(start: int, end: int | None, out_name: str) -> Path:
    font_name = register_fonts()
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TitleRO",
        parent=styles["Heading1"],
        fontName=font_name,
        fontSize=16,
        leading=20,
        spaceAfter=8,
    )
    h_style = ParagraphStyle(
        "HeadRO",
        parent=styles["Heading2"],
        fontName=font_name,
        fontSize=12,
        leading=15,
        spaceBefore=6,
        spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "BodyRO",
        parent=styles["BodyText"],
        fontName=font_name,
        fontSize=9,
        leading=12,
        spaceAfter=2,
    )
    note_style = ParagraphStyle(
        "NoteRO",
        parent=styles["BodyText"],
        fontName=font_name,
        fontSize=8,
        leading=10,
        textColor="#555555",
        spaceAfter=8,
    )

    out_path = ROOT / out_name
    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title="Roadnet — Ghid de operațiuni (traducere RO)",
        author="Transitix translation pipeline",
    )

    progress = load_progress()
    done = progress.get("done", {})
    keys = sorted((int(k) for k in done), key=int)
    if end is not None:
        keys = [k for k in keys if start <= k <= end]
    else:
        keys = [k for k in keys if k >= start]

    story = []
    story.append(Paragraph("Roadnet — Ghid de operațiuni", title_style))
    story.append(
        Paragraph(
            "Traducere automată în română din manualul oficial (captură de ecran în "
            "portugheză). Pe fiecare pagină: imaginea originală + textul OCR tradus. "
            "Interfața din capturi rămâne în limba originală; traducerea e transcriptul "
            "de dedesubt. Calitatea OCR pe UI poate varia.",
            note_style,
        )
    )
    story.append(PageBreak())

    page_width = A4[0] - 28 * mm
    for page_no in keys:
        img_path = PAGES / f"page-{page_no:04d}.jpg"
        ro_path = TEXT / f"page-{page_no:04d}.ro.txt"
        if not img_path.exists() or not ro_path.exists():
            continue
        story.append(Paragraph(f"Pagina {page_no} (original)", h_style))
        # keep aspect ratio; cap height so text still fits on following flow
        img = RLImage(str(img_path))
        iw, ih = img.imageWidth, img.imageHeight
        scale = min(page_width / iw, (A4[1] * 0.62) / ih)
        img.drawWidth = iw * scale
        img.drawHeight = ih * scale
        story.append(img)
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph(f"Traducere română — pagina {page_no}", h_style))
        ro = ro_path.read_text(encoding="utf-8").strip()
        if not ro:
            story.append(Paragraph("(Fără text detectat pe această pagină.)", note_style))
        else:
            for line in ro.splitlines():
                line = line.strip()
                if not line:
                    story.append(Spacer(1, 2 * mm))
                    continue
                story.append(Paragraph(escape_xml(line), body_style))
        story.append(PageBreak())
        print(f"  assembled page {page_no}")

    doc.build(story)
    print(f"Wrote {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)")
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=None, help="inclusive; default = all")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--build-only", action="store_true")
    parser.add_argument(
        "--out",
        default="Manual-Roadnet-Ghid-Operatiuni-RO.pdf",
        help="output filename inside officialRoadnetManual/",
    )
    args = parser.parse_args()

    if not TESSERACT.exists():
        print("Tesseract not found at", TESSERACT, file=sys.stderr)
        return 2
    if not (TESSDATA / "por.traineddata").exists():
        print("Missing por.traineddata in", TESSDATA, file=sys.stderr)
        return 2

    if not args.build_only:
        process_pages(args.start, args.end, force=args.force)
    build_pdf(args.start, args.end, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
