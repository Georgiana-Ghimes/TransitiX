#!/usr/bin/env python3
"""Baumit-shaped route corpus: golden path + edge PDFs, degraded photo PNGs, manifest.

Layout mirrors real Baumit avize:
  Expeditor (BOL / Republicii) | logo row
  Adresa de livrare (left) \\t Client (right)
  Client factură / Referință / Transportator / TPO / plates
  Produs table stub + footer Maniu 061129

Regenerate:
  python3 fixtures/baumit-route-corpus/generate.py
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent
PDF_DIR = ROOT / "pdf"
PNG_DIR = ROOT / "png"
DEG_DIR = ROOT / "photo" / "degraded"
for d in (PDF_DIR, PNG_DIR, DEG_DIR):
    d.mkdir(parents=True, exist_ok=True)

FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]

EXP = {
    "site": "BOL Bolintin",
    "street": "Str. Republicii, nr. 1F",
    "locality": "Bolintin-Deal",
    "postcode": "087015",
}

# (slug, kind, site_name, street, locality_printed, postcode, client_name, client_street,
#  client_locality, client_pc, expect_locality, expect_street_substr, plate, notes)
CASES = [
    # --- golden path (correct print) ---
    ("g01-viilor-ok", "golden", "CS-CONCELEX", "Sosea Viilor nr. 52",
     "Bucuresti Sector 5", "050151", "C23901527 CONCELEX SRL",
     "Str. Aeroportului 120-130", "Bucuresti Sector 1", "013596",
     "Bucuresti", "Viilor", "B 91 RSP", "golden Viilor"),
    ("g02-ghencea-ok", "golden", "DEDEMAN GHENCEA", "Bdul Ghencea nr. 91",
     "Bucuresti Sector 6", "061692", "C23941047 DEDEMAN GHENCEA",
     "Bdul Ghencea Nr. 91", "Bucuresti Sector 6", "061692",
     "Bucuresti", "Ghencea", "B 330 SRS", "golden Ghencea"),
    ("g03-iancu-ok", "golden", "CS-CONCELEX- OBI LOHN", "Bulevardul Iancu nr. 30",
     "Bucuresti Sector 1", "011743", "C23000014 AP-CONCELEX",
     "Strada Aeroportului nr. 120-T", "Bucuresti Sector 1", "013596",
     "Bucuresti", "Iancu", "B 330 SRS", "golden Iancu"),
    ("g04-privighetorilor-ok", "golden", "CS-ROCKWOOL",
     "Aleea Privighetorilor nr. 1A", "Bucuresti Sector 1", "014031",
     "C23941290 ROCKWOOL ROMANIA SRL", "Sos. BUCURESTI-PLOIESTI 1A",
     "Bucuresti Sector 1", "013682", "Bucuresti", "Privighetorilor", "B 112 ALZ",
     "golden Privighetorilor"),
    ("g05-metalurgiei-ok", "golden", "CS-AVALON OBI BROWN",
     "Bulevardul Metalurgiei nr. 84", "Bucuresti Sector 4", "041837",
     "C23941012 AVALON ROMANIA", "BDUL METALURGIEI NR. 61",
     "Bucuresti Sector 4", "041832", "Bucuresti", "Metalurgiei", "B 172 RSP",
     "golden Metalurgiei"),
    ("g06-pipera-voluntari", "golden", "CS-NORDIC - OBI PIPERA",
     "Bulevardul Pipera nr. 1/VII", "Voluntari", "077190",
     "C23911230 NORDIC BUILD SRL", "Strada Aeroportului nr. 72",
     "Bucuresti Sector 1", "013596", "Voluntari", "Pipera", "B 404 RZC",
     "Ilfov Voluntari"),
    ("g07-campina-ok", "golden", "ZONE CONSTRUCT SRL", "Str. Bobalna nr. 16",
     "Campina", "105600", "C23940315 ZONE CONSTRUCT SRL",
     "Str. Bobalna nr. 16", "Campina", "105600", "Campina", "Bobalna",
     "B 515 BAU", "Prahova Campina"),
    ("g08-chiajna-ok", "golden", "GREEN-OBI CHIAJNA", "Strada Ilie Petre nr. 98",
     "Chiajna", "077040", "C23934309 GREEN SWAN SRL",
     "STR. ALEEA CU MAGNOLII NR. 23", "CORBEANCA", "077065",
     "Chiajna", "Ilie Petre", "B 112 RMP", "Ilfov Chiajna vs Corbeanca client"),
    ("g09-sabareni-ok", "golden", "DEMOS-OBI PRO DEPOZ", "str Principala nr. 220",
     "Sabareni", "087153", "C23901185 DEMOS INTERMED SRL",
     "Locotenent Moga Nr. 18", "Fundeni", "077086",
     "Sabareni", "Principala", "B 330 SRS", "Sabareni not Fundeni"),
    ("g10-ciulnita-ok", "golden", "ARABESQUE- GALATI", "Salcamilor nr. 1A",
     "Ciulnita", "927080", "C23940730 ARABESQUE- GALATI",
     "Str. Drumul de Centura Nr. 39", "Galati", "800248",
     "Ciulnita", "Salcamilor", "B 112 RMP", "Ciulnita not Galati"),
    ("g11-maniu-ok", "golden", "CS-LOKI", "Bvd. Iuliu Maniu nr. 1",
     "Bucuresti Sector 6", "061129", "C23950001 LOKI TRANSPORT",
     "Str. Facturare 9", "Bucuresti Sector 1", "010101",
     "Bucuresti", "Maniu", "B 91 RSP", "Maniu Sector 6"),
    ("g12-unirii-ok", "golden", "CS-NORDIC", "Str. Unirii nr. 22",
     "Bucuresti Sector 3", "030123", "C23950002 NORDIC LOGISTICS",
     "Bd. Independentei 4", "Brasov", "500001",
     "Bucuresti", "Unirii", "BV 10 NRD", "Unirii Sector 3"),

    # --- wrong town Timisoara + Bucuresti CP ---
    ("e01-demoval-timisoara-cp", "edge-cp", "CS-DEMOVAL - OBI TIMISOARA",
     "Bulevardul Timisoara nr. 26", "Timisoara", "061344",
     "C23901190 DEMOVAL INTERMED SRL", "Strada Locotenent Moga nr. 18",
     "Fundeni", "077086", "Bucuresti", "Timisoara", "B 940 GXS",
     "CP forces Bucuresti; street may stay Timisoara"),
    ("e02-viilor-timisoara-cp", "edge-cp", "CS-CONCELEX",
     "Sosea Viilor nr. 52", "Timisoara", "050151",
     "C23901527 CONCELEX SRL", "Str. Aeroportului 120",
     "Bucuresti Sector 1", "013596", "Bucuresti", "Viilor", "B 91 RSP",
     "wrong Timisoara + 050151"),
    ("e03-ghencea-timisoara-cp", "edge-cp", "DEDEMAN GHENCEA",
     "Bdul Ghencea nr. 91", "Timisoara", "061692",
     "C23941047 DEDEMAN", "Bdul Ghencea 91",
     "Bucuresti Sector 6", "061692", "Bucuresti", "Ghencea", "B 330 SRS",
     "wrong Timisoara + 061692"),
    ("e04-iancu-timisoara-cp", "edge-cp", "CS-CONCELEX- OBI LOHN",
     "Bulevardul Iancu nr. 30", "Timisoara", "011743",
     "C23000014 AP-CONCELEX", "Strada Aeroportului 120",
     "Bucuresti Sector 1", "013596", "Bucuresti", "Iancu", "B 330 SRS",
     "wrong Timisoara + 011743"),
    ("e05-metalurgiei-timisoara-cp", "edge-cp", "CS-AVALON OBI BROWN",
     "Bulevardul Metalurgiei nr. 84", "Timisoara", "041837",
     "C23941012 AVALON", "BDUL METALURGIEI 61",
     "Bucuresti Sector 4", "041832", "Bucuresti", "Metalurgiei", "B 172 RSP",
     "wrong Timisoara + 041837"),
    ("e06-nocity-timisoara-street", "edge-cp", "CS-DEMOVAL - OBI TIMISOARA",
     "Bulevardul Timisoara nr. 26", "", "061344",
     "C23901190 DEMOVAL", "Locotenent Moga 18",
     "Fundeni", "077086", "Bucuresti", "Timisoara", "B 940 GXS",
     "missing locality line; CP fills Bucuresti"),
    ("e07-galati-name-ciulnita-cp", "edge-cp", "ARABESQUE- GALATI",
     "Salcamilor nr. 1A", "Galati", "927080",
     "C23940730 ARABESQUE", "Drumul de Centura 39",
     "Galati", "800248", "Ciulnita", "Salcamilor", "B 112 RMP",
     "NOTE: 927xxx is not Bucuresti range — expect OCR locality Galati unless CP map grows"),
    ("e08-real-timisoara-300001", "negative", "Depozit Timisoara",
     "Bulevardul Take Ionescu nr. 10", "Timisoara", "300001",
     "C23909999 TIMISOARA LOGISTICS SRL", "Str. Facturare 1",
     "Timisoara", "300001", "Timisoara", "Take Ionescu", "TM 10 ABC",
     "must NOT force Bucuresti"),
    ("e09-cluj-wrong-on-pipera", "edge-cp", "CS-DELTA",
     "Bulevardul Pipera nr. 1/VII", "Cluj-Napoca", "014254",
     "C23922001 DELTA CARGO", "Str. Aeroportului 12",
     "Otopeni", "075100", "Bucuresti", "Pipera", "IF 22 DLT",
     "Cluj printed + Bucuresti CP 014254"),
    ("e10-bistrita-wrong-maniu", "edge-cp", "CS-LOKI",
     "Bvd. Iuliu Maniu nr. 1", "Bistrita", "061129",
     "C23950001 LOKI", "Str. Facturare 9",
     "Bucuresti Sector 1", "010101", "Bucuresti", "Maniu", "B 91 RSP",
     "Bistrita + Maniu CP"),

    # --- client traps / column noise ---
    ("t01-client-aeroportului", "trap", "CS-CONCELEX",
     "Sosea Viilor nr. 52", "Bucuresti Sector 5", "050151",
     "C23901527 CONCELEX SRL", "Strada Aeroportului nr. 120-T",
     "Bucuresti Sector 1", "013596", "Bucuresti", "Viilor", "B 34 BAU",
     "must not take Aeroportului"),
    ("t02-client-fundeni", "trap", "DEMOS-OBI PRO DEPOZ",
     "str Principala nr. 220", "Sabareni", "087153",
     "C23901185 DEMOS", "Locotenent Moga Nr. 18",
     "Fundeni", "077086", "Sabareni", "Principala", "B 330 SRS",
     "must not take Fundeni"),
    ("t03-ref-andronache-trap", "trap", "GREEN-OBI CHIAJNA",
     "Strada Ilie Petre nr. 98", "Chiajna", "077040",
     "C23934309 GREEN SWAN SRL", "ALEEA CU MAGNOLII 23",
     "CORBEANCA", "077065", "Chiajna", "Ilie Petre", "B 112 RMP",
     "ref Andronache must not win"),
    ("t04-client-name-starts-client", "trap", "Depozit Timisoara",
     "Bulevardul Take Ionescu nr. 10", "Timisoara", "300001",
     "Client Timisoara SRL", "Str. Facturare 1",
     "Timisoara", "300001", "Timisoara", "Take Ionescu", "TM 10 ABC",
     "company name Client … SRL must not truncate"),
]

# Extra synthetic golden streets × sectors for volume (Bucuresti CP)
# (slug_token, street_line, postcode, sector, street_hint_for_tests)
EXTRA_STREETS = [
    ("victoriei", "Calea Victoriei nr. 88", "010061", 1, "Victoriei"),
    ("magheru", "Bvd. Magheru nr. 12", "010131", 1, "Magheru"),
    ("dorobanti", "Calea Dorobantilor nr. 5", "010553", 1, "Dorobantilor"),
    ("floreasca", "Calea Floreasca nr. 169", "014472", 2, "Floreasca"),
    ("barbu-vacarescu", "Bvd. Barbu Vacarescu nr. 201", "020276", 2, "Vacarescu"),
    ("mihai-bravu", "Sos. Mihai Bravu nr. 100", "021327", 3, "Bravu"),
    ("basarabiei", "Sos. Basarabiei nr. 40", "022103", 3, "Basarabiei"),
    ("oltenitei", "Sos. Oltenitei nr. 209", "041303", 4, "Oltenitei"),
    ("berceni", "Sos. Berceni nr. 12", "041915", 4, "Berceni"),
    ("rahovei", "Calea Rahovei nr. 266", "050909", 5, "Rahovei"),
    ("panduri", "Sos. Panduri nr. 90", "050726", 5, "Panduri"),
    ("maniu-600", "Bvd. Iuliu Maniu nr. 600", "061129", 6, "Maniu"),
    ("drumul-taberei", "Sos. Drumul Taberei nr. 35", "061357", 6, "Taberei"),
    ("giulesti", "Calea Giulesti nr. 6", "060274", 6, "Giulesti"),
    ("timisoara-bvd", "Bulevardul Timisoara nr. 26", "061344", 6, "Timisoara"),
]


def register_font():
    for fc in FONT_PATHS:
        if Path(fc).exists():
            pdfmetrics.registerFont(TTFont("UiFont", fc))
            return "UiFont", fc
    raise SystemExit("Need Arial TTF")


def expand_cases():
    out = list(CASES)
    n = 0
    for token, street, pc, sector, hint in EXTRA_STREETS:
        n += 1
        out.append((
            f"x{n:02d}-{token}-ok",
            "golden-extra",
            f"CS-EXTRA-{token.upper()[:8]}",
            street,
            f"Bucuresti Sector {sector}",
            pc,
            f"C2396{n:04d} EXTRA CLIENT SRL",
            "Str. Facturare 1",
            "Bucuresti Sector 1",
            "010101",
            "Bucuresti",
            hint,
            f"B {10 + n:02d} EXT",
            f"extra golden {token}",
        ))
        out.append((
            f"x{n:02d}-{token}-timisoara",
            "edge-cp",
            f"CS-EXTRA-{token.upper()[:8]} OBI TIMISOARA",
            street,
            "Timisoara",
            pc,
            f"C2396{n:04d} EXTRA CLIENT SRL",
            "Str. Facturare 1",
            "Fundeni",
            "077086",
            "Bucuresti",
            hint,
            f"B {20 + n:02d} EXT",
            f"extra Timisoara trap {token}",
        ))
    return out


def raw_text_for(case, tpo: str, psl: str) -> str:
    (
        slug, kind, site, street, loc, pc, cname, cstreet, cloc, cpc,
        _el, _es, plate, _note,
    ) = case
    loc_line = f"{loc} RO {pc}".strip() if loc else f"RO {pc}"
    cloc_line = f"{cloc} RO {cpc}"
    return "\n".join([
        "Baumit Romania Com SRL",
        "Expeditor",
        f"Site: {EXP['site']}",
        f"{EXP['street']} {EXP['locality']} RO {EXP['postcode']} ROU",
        f"Aviz de expeditie: {psl}",
        f"Data avizului de expeditie: 19.10.2026",
        f"Comanda vanzare: SOR-00{psl[-5:]}",
        "Adresa de livrare\tClient",
        f"{site}\t{cname}",
        f"{street}\t{cstreet}",
        f"{loc_line}\t{cloc_line}",
        "ROU\tROU",
        f"Client factura:\t{cname}",
        f"Referinta client:\t{street}",
        "Transportator:\tEKAER",
        f"Placuta de inmatriculare\t{plate}",
        f"Comanda de transport\t{tpo}",
        "Produs\tCantitate",
        "FinoGrande 20 kg\t100.00 sac",
        "Greutate bruta 12500 kg",
        "Baumit Romania Com SRL, Sediu: Bucuresti, B-dul Iuliu Maniu nr. 600A, Sector 6, 061129",
    ])


def draw_pdf(path: Path, font: str, case, tpo: str, psl: str):
    (
        slug, kind, site, street, loc, pc, cname, cstreet, cloc, cpc,
        _el, _es, plate, note,
    ) = case
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4
    y = h - 12 * mm

    def line(s, size=10, dy=4.2 * mm, fill=(0, 0, 0), x=14 * mm, bold=False):
        nonlocal y
        c.setFillColorRGB(*fill)
        c.setFont(font, size)
        c.drawString(x, y, s)
        y -= dy

    # Header like Baumit
    line("Baumit Romania Com SRL", 11, 4 * mm, fill=(0.1, 0.1, 0.45))
    line(f"Aviz de expeditie: {psl}", 12, 4.5 * mm)
    line("Data avizului de expeditie: 19.10.2026", 9, 3.8 * mm)
    line(f"Comanda vanzare: SOR-00{psl[-5:]}", 9, 5 * mm)
    line(f"[{kind}] {slug}", 7, 4 * mm, fill=(0.45, 0.15, 0.1))

    line("Expeditor", 10, 4 * mm)
    line(f"Site: {EXP['site']}", 9.5, 3.8 * mm)
    line(f"{EXP['street']} {EXP['locality']} RO {EXP['postcode']} ROU", 9.5, 5 * mm)

    loc_line = f"{loc} RO {pc}".strip() if loc else f"RO {pc}"
    left = [site, street, loc_line, "ROU"]
    right = [cname, cstreet, f"{cloc} RO {cpc}", "ROU"]
    c.setFont(font, 10)
    c.setFillColorRGB(0, 0, 0)
    c.drawString(14 * mm, y, "Adresa de livrare\tClient")
    y -= 4.5 * mm
    for i in range(max(len(left), len(right))):
        L = left[i] if i < len(left) else ""
        R = right[i] if i < len(right) else ""
        c.setFont(font, 9)
        c.drawString(14 * mm, y, f"{L}\t{R}")
        y -= 4 * mm

    y -= 2 * mm
    line(f"Client factura: {cname}", 8.5, 3.6 * mm)
    line(f"Referinta client: {street}", 8.5, 3.6 * mm)
    line("Transportator: EKAER", 8.5, 3.6 * mm)
    line(f"Placuta de inmatriculare: {plate}", 8.5, 3.6 * mm)
    line(f"Comanda de transport: {tpo}", 8.5, 5 * mm)
    line("Produs: FinoGrande 20 kg | 100.00 sac | Greutate bruta 12500 kg", 8, 5 * mm)
    c.setFillColorRGB(0.35, 0.35, 0.35)
    c.setFont(font, 6.5)
    c.drawString(14 * mm, 10 * mm,
                 "Sediu: Bucuresti, B-dul Iuliu Maniu nr. 600A, Sector 6, 061129 | " + note[:80])
    c.showPage()
    c.save()


def render_png_from_text(path: Path, font_path: str, case, tpo: str, psl: str):
    """Raster ‘scan’ of the same content for photo-degrade pipeline."""
    text = raw_text_for(case, tpo, psl)
    img = Image.new("RGB", (1240, 1754), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype(font_path, 22)
        font_sm = ImageFont.truetype(font_path, 16)
    except Exception:
        font = ImageFont.load_default()
        font_sm = font
    y = 40
    for i, row in enumerate(text.split("\n")):
        draw.text((40, y), row.replace("\t", "    |    "), fill=(0, 0, 0),
                  font=font if i < 8 else font_sm)
        y += 28 if i < 8 else 24
    img.save(path)


def degrade(img: Image.Image, mode: str, rng: random.Random) -> Image.Image:
    out = img.convert("RGB")
    if mode == "tilt-left":
        out = out.rotate(7, expand=True, fillcolor=(230, 230, 225))
    elif mode == "tilt-right":
        out = out.rotate(-9, expand=True, fillcolor=(230, 230, 225))
    elif mode == "skew":
        out = out.rotate(3, expand=True, fillcolor=(240, 240, 235))
        out = ImageOps.autocontrast(out)
    elif mode == "blur":
        out = out.filter(ImageFilter.GaussianBlur(radius=1.4))
    elif mode == "dark":
        out = ImageEnhance.Brightness(out).enhance(0.72)
        out = ImageEnhance.Contrast(out).enhance(1.15)
    elif mode == "glare":
        overlay = Image.new("RGBA", out.size, (255, 255, 255, 0))
        d = ImageDraw.Draw(overlay)
        d.ellipse((out.width * 0.35, 80, out.width * 0.85, 420),
                  fill=(255, 255, 240, 110))
        out = Image.alpha_composite(out.convert("RGBA"), overlay).convert("RGB")
    elif mode == "stain":
        overlay = Image.new("RGBA", out.size, (255, 255, 255, 0))
        d = ImageDraw.Draw(overlay)
        for _ in range(12):
            x, y = rng.randint(40, out.width - 80), rng.randint(200, out.height - 200)
            r = rng.randint(18, 55)
            d.ellipse((x, y, x + r, y + r), fill=(120, 90, 40, rng.randint(40, 90)))
        out = Image.alpha_composite(out.convert("RGBA"), overlay).convert("RGB")
    elif mode == "stamp":
        overlay = Image.new("RGBA", out.size, (255, 255, 255, 0))
        d = ImageDraw.Draw(overlay)
        box = (out.width * 0.45, out.height * 0.55, out.width * 0.92, out.height * 0.78)
        d.rectangle(box, outline=(30, 60, 160, 180), width=4)
        d.text((box[0] + 20, box[1] + 30), "CONTROL POARTA", fill=(30, 60, 160, 200))
        d.text((box[0] + 20, box[1] + 70), "IESIRE / INTRARE", fill=(30, 60, 160, 180))
        out = Image.alpha_composite(out.convert("RGBA"), overlay).convert("RGB")
        out = out.rotate(-2, expand=True, fillcolor=(245, 245, 240))
    elif mode == "noise":
        pixels = out.load()
        for _ in range(8000):
            x, y = rng.randint(0, out.width - 1), rng.randint(0, out.height - 1)
            v = rng.randint(0, 255)
            pixels[x, y] = (v, v, v)
    return out


DEGRADE_MODES = [
    "tilt-left", "tilt-right", "skew", "blur", "dark",
    "glare", "stain", "stamp", "noise",
]


def fold_loc(value: str) -> str:
    return (
        str(value or "")
        .lower()
        .replace("ă", "a")
        .replace("â", "a")
        .replace("î", "i")
        .replace("ș", "s")
        .replace("ş", "s")
        .replace("ț", "t")
        .replace("ţ", "t")
    )


def expect_for(case) -> dict:
    (
        slug, kind, site, street, loc, pc, cname, cstreet, cloc, cpc,
        expect_loc, expect_street, plate, note,
    ) = case
    # Special: Galati printed + 927080 — current code has no 92→Ciulnita map
    if slug.startswith("e07-"):
        expect_loc = "Galati"
    force_buc = False
    if pc and len(pc) == 6 and 1 <= int(pc[:2]) <= 6:
        force_buc = expect_loc == "Bucuresti"
    return {
        "slug": slug,
        "kind": kind,
        "expect_locality": expect_loc,
        "expect_street_substr": expect_street,
        "expect_postcode": pc,
        "expect_plate_norm": "-".join(plate.split()),
        "must_not_locality": (
            ["Timisoara"]
            if force_buc and loc and fold_loc(loc) == "timisoara"
            else []
        ),
        "note": note,
        "force_bucuresti_from_cp": force_buc,
    }


def main():
    font, font_path = register_font()
    cases = expand_cases()
    rng = random.Random(42)

    for old in list(PDF_DIR.glob("*.pdf")) + list(PNG_DIR.glob("*.png")) + list(DEG_DIR.glob("*.png")):
        old.unlink()

    manifest = []
    print(f"Generating {len(cases)} cases…")
    for i, case in enumerate(cases):
        slug = case[0]
        tpo = f"TPO-{9_900_000 + i:07d}"
        psl = f"PSL-{9_800_000 + i:07d}"
        pdf_path = PDF_DIR / f"{slug}.pdf"
        png_path = PNG_DIR / f"{slug}.png"
        draw_pdf(pdf_path, font, case, tpo, psl)
        render_png_from_text(png_path, font_path, case, tpo, psl)

        deg_modes = []
        # Degrade a representative subset heavily; light touch on all golden/edge
        modes = DEGRADE_MODES if case[1] in ("golden", "edge-cp", "negative", "trap") else ["stamp", "tilt-left"]
        if case[1] == "golden-extra":
            modes = [rng.choice(DEGRADE_MODES)]
        for mode in modes:
            deg = degrade(Image.open(png_path), mode, rng)
            deg_name = f"{slug}__{mode}.png"
            deg.save(DEG_DIR / deg_name)
            deg_modes.append(deg_name)

        exp = expect_for(case)
        # Fix must_not for Timisoara wrong-town cases
        if case[1] == "edge-cp" and case[5] and case[5][:2] in {f"{n:02d}" for n in range(1, 7)}:
            if case[4] and case[4].lower() == "timisoara":
                exp["must_not_locality"] = ["Timisoara"]
            if "cluj" in slug or "bistrita" in slug:
                exp["must_not_locality"] = [case[4]]

        manifest.append({
            **exp,
            "tpo": tpo,
            "psl": psl,
            "plate": case[12],
            "pdf": f"pdf/{slug}.pdf",
            "png": f"png/{slug}.png",
            "degraded": deg_modes,
            "raw_text": raw_text_for(case, tpo, psl),
            "origin_substr": "Republicii",
            "origin_locality": "Bolintin-Deal",
        })

    man_path = ROOT / "manifest.json"
    man_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(manifest)} cases → {man_path}")
    print(f"  PDFs: {len(list(PDF_DIR.glob('*.pdf')))}")
    print(f"  PNGs: {len(list(PNG_DIR.glob('*.png')))}")
    print(f"  Degraded: {len(list(DEG_DIR.glob('*.png')))}")


if __name__ == "__main__":
    main()
