#!/usr/bin/env python3
"""Regenerate ClickUp #71 route-separator PDF + PNG fixtures."""

from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont
import json

ROOT = Path(__file__).resolve().parent
PDF_DIR = ROOT / "pdf"
PNG_DIR = ROOT / "png"
PDF_DIR.mkdir(exist_ok=True)
PNG_DIR.mkdir(exist_ok=True)

VARIANTS = [
    ("01_sep-unicode-arrow", "Unicode arrow →",
     "BOL Bolintin → Șoseaua Viilor nr. 52, București", "expect ZB Viilor"),
    ("02_sep-ascii-arrow", "ASCII arrow ->",
     "BOL Bolintin -> Șoseaua Viilor nr. 52, București", "expect ZB Viilor"),
    ("03_sep-spaced-hyphen", "Spaced hyphen -",
     "BOL Bolintin - Șoseaua Viilor nr. 52, București", "expect ZB Viilor"),
    ("04_sep-en-dash", "En dash –",
     "BOL Bolintin – Șoseaua Viilor nr. 52, București", "expect ZB Viilor"),
    ("05_sep-em-dash", "Em dash —",
     "BOL Bolintin — Șoseaua Viilor nr. 52, București", "expect ZB Viilor"),
    ("06_sep-slash", "Slash /",
     "BOL Bolintin / Șoseaua Viilor nr. 52, București", "expect ZB Viilor (control)"),
    ("07_origin-deal-unicode-arrow", "Bolintin-Deal + →",
     "Str. Industriei nr. 7, Bolintin-Deal → Șoseaua Viilor nr. 52, sector 5, București",
     "Deal must stay in origin"),
    ("08_origin-deal-ascii-arrow", "Bolintin-Deal + ->",
     "Str. Industriei nr. 7, Bolintin-Deal -> Șoseaua Viilor nr. 52, sector 5, București",
     "Deal must stay in origin"),
    ("09_origin-deal-spaced-hyphen", "Bolintin-Deal + spaced -",
     "Str. Industriei nr. 7, Bolintin-Deal - Șoseaua Viilor nr. 52, sector 5, București",
     "Deal must stay in origin"),
    ("10_origin-deal-slash", "Bolintin-Deal + /",
     "Str. Industriei nr. 7, Bolintin-Deal / Șoseaua Viilor nr. 52, sector 5, București",
     "Deal must stay in origin"),
    ("11_delivery-only-no-separator", "Delivery only",
     "Șoseaua Viilor nr. 52, București", "no separator"),
    ("12_negative-glued-hyphen-bolintin-deal", "NEGATIVE Bolintin-Deal only",
     "Str. Republicii nr. 1F, Bolintin-Deal", "must NOT tax București"),
]

BASE_TPO = 332710
BASE_PSL = 662710

FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def register_font():
    for fc in FONT_PATHS:
        if Path(fc).exists():
            pdfmetrics.registerFont(TTFont("UiFont", fc))
            return "UiFont", fc
    raise SystemExit("Need Arial Unicode (or Arial) TTF")


def draw_pdf(path, font, idx, slug, label, ruta, note):
    tpo = f"TPO-{BASE_TPO + idx:07d}"
    psl = f"PSL-{BASE_PSL + idx:07d}"
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4
    y = h - 18 * mm

    def text(s, size=11, dy=6.5 * mm, fill=(0, 0, 0), x=18 * mm):
        nonlocal y
        c.setFillColorRGB(*fill)
        c.setFont(font, size)
        c.drawString(x, y, s)
        y -= dy

    text("Baumit Romania Com SRL — DOCUMENT DE TEST", 14, 7 * mm)
    text(f"ClickUp #71 · {slug}", 9, 5 * mm, fill=(0.5, 0.1, 0.1))
    text(label, 10, 8 * mm, fill=(0.2, 0.2, 0.2))

    fields = [
        ("Expeditor Site", "BOL Bolintin"),
        ("Aviz de expeditie", psl),
        ("Data avizului de expeditie", "09.10.2026"),
        ("Comanda de transport / TPO", tpo),
        ("Nr. auto", "B 112 VFM / B 475 AGR"),
        ("Adresa de livrare / Ruta", ruta),
        ("Produs", "FinoGrande 20 kg"),
        ("Cantitate", "100.00 sac"),
        ("Greutate neta", "2.000,00 kg"),
        ("Greutate bruta", "12.500,00 kg"),
    ]
    for k, v in fields:
        c.setFont(font, 10)
        c.setFillColorRGB(0, 0, 0)
        c.drawString(18 * mm, y, f"{k}:")
        max_w = w - 75 * mm
        if c.stringWidth(v, font, 10) > max_w:
            c.drawString(70 * mm, y, v[:48])
            y -= 5 * mm
            c.drawString(70 * mm, y, v[48:])
        else:
            c.drawString(70 * mm, y, v)
        y -= 7 * mm

    y -= 3 * mm
    text(f"Expected: {note}", 9, 6 * mm, fill=(0.1, 0.2, 0.55))
    text("DOCUMENT DE TEST — DATE FICTIVE — fixtures/clickup-71-route-separators",
         8, 5 * mm, fill=(0.45, 0.45, 0.45))
    c.showPage()
    c.save()
    return tpo, psl


def draw_png(path, idx, slug, label, ruta, note, tpo, psl):
    W, H = 1240, 1754
    img = Image.new("RGB", (W, H), (245, 242, 235))
    d = ImageDraw.Draw(img)
    try:
        font_title = ImageFont.truetype(FONT_PATHS[1], 36)
        font = ImageFont.truetype(FONT_PATHS[1], 28)
        font_sm = ImageFont.truetype(FONT_PATHS[1], 22)
    except Exception:
        font_title = font = font_sm = ImageFont.load_default()

    d.rectangle([40, 40, W - 40, H - 40], outline=(180, 170, 150), width=2)
    y = 80
    d.text((80, y), "Baumit Romania Com SRL — DOCUMENT DE TEST", fill=(20, 20, 20), font=font_title)
    y += 55
    d.text((80, y), f"ClickUp #71 · {slug}", fill=(140, 40, 40), font=font_sm)
    y += 40
    d.text((80, y), label, fill=(60, 60, 60), font=font)
    y += 60

    rows = [
        ("Expeditor Site", "BOL Bolintin"),
        ("Aviz de expeditie", psl),
        ("Data avizului", "09.10.2026"),
        ("Comanda / TPO", tpo),
        ("Nr. auto", "B 112 VFM / B 475 AGR"),
        ("Adresa de livrare / Ruta", ruta),
        ("Produs", "FinoGrande 20 kg"),
        ("Cantitate", "100.00 sac"),
        ("Greutate neta", "2.000,00 kg"),
        ("Greutate bruta", "12.500,00 kg"),
    ]
    for k, v in rows:
        d.text((80, y), f"{k}:", fill=(0, 0, 0), font=font)
        if len(v) > 42:
            d.text((420, y), v[:42], fill=(0, 0, 0), font=font)
            y += 36
            d.text((420, y), v[42:], fill=(0, 0, 0), font=font)
        else:
            d.text((420, y), v, fill=(0, 0, 0), font=font)
        y += 48

    y += 20
    d.text((80, y), f"Expected: {note}", fill=(30, 60, 140), font=font_sm)
    y += 40
    d.text((80, y), "DOCUMENT DE TEST — DATE FICTIVE", fill=(120, 120, 120), font=font_sm)
    img.save(path, "PNG", optimize=True)


def main():
    font, font_path = register_font()
    print("font", font_path)
    manifest = []
    for i, (slug, label, ruta, note) in enumerate(VARIANTS, start=1):
        pdf_path = PDF_DIR / f"{slug}.pdf"
        png_path = PNG_DIR / f"{slug}.png"
        tpo, psl = draw_pdf(pdf_path, font, i, slug, label, ruta, note)
        draw_png(png_path, i, slug, label, ruta, note, tpo, psl)
        manifest.append({
            "index": i,
            "slug": slug,
            "label": label,
            "ruta": ruta,
            "note": note,
            "tpo": tpo,
            "psl": psl,
            "pdf": f"pdf/{pdf_path.name}",
            "png": f"png/{png_path.name}",
        })
        print("wrote", slug)

    (ROOT / "manifest.json").write_text(
        json.dumps({"clickup": 71, "count": len(manifest), "items": manifest},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("manifest.json OK — merge 00_all-12-variants.pdf with: node pdf-lib (see prior step)")
    print("Or: open each pdf/ file. Bundle merge left to npm pdf-lib if needed.")


if __name__ == "__main__":
    main()
