"""Romanian logistics post-correction for OCR (carnet / aviz HW).

Paddle `latin` is printed-text. English TrOCR is disabled. Repair codes, labels,
plates, dates and common RAI place/cargo tokens; then a document-level pass
stitches split lines and orphan digit tails.
"""

from __future__ import annotations

import re
from typing import Iterable

_LABEL_FIXES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^(?:d\s*a\s*t\s*a|a\s*t\s*a)\b", re.I), "DATA"),
    (re.compile(r"^n\s*r\.?\s*[a4]\s*u\s*t\s*o\b", re.I), "NR. AUTO"),
    (re.compile(r"^n\s*r\.?\s*c\s*u\s*r\s*s", re.I), "NR. CURSE"),
    (re.compile(r"^n\s*r\.?\s*[d5c]\s*[ou]?\s*c", re.I), "NR. DOCUMENT"),
    (re.compile(r"^r\s*u\s*[tl]\s*[aă]\b", re.I), "RUTA"),
    (re.compile(r"^t\s*i\s*p\s*m\s*[a4]\s*r\s*[fe]\b", re.I), "TIP MARFA"),
    (re.compile(r"^c\s*a\s*n\s*t(?:\s*i\s*t\s*a\s*t\s*e)?(?:\s*m\s*[a4]\s*r\s*f)?", re.I), "CANT MARFA"),
    (re.compile(r"^c\s*a\s*n\s*t\s*i\s*t\s*a\s*t\s*e\b", re.I), "CANT MARFA"),
    (re.compile(r"^g\s*r\s*e\s*u\s*t\s*a\s*t\s*e\s*n\s*e\s*t", re.I), "GREUTATE NETA"),
    (re.compile(r"^g\s*(?:r\s*e\s*u\s*t\s*a\s*t\s*e\s*)?b\s*r\s*u", re.I), "GREUTATE BRUTA"),
    (re.compile(r"^e\s*x\s*p\s*e\s*d", re.I), "EXPEDITOR"),
    (re.compile(r"^a\s*d\s*r\s*e\s*s", re.I), "ADRESA"),
    (re.compile(r"^a\s*v\s*i\s*z", re.I), "AVIZ"),
    (re.compile(r"^c\s*o\s*m\s*a\s*n\s*d", re.I), "COMANDA"),
]

_CANON_HEADS = tuple(c for _, c in _LABEL_FIXES)

_CODE_LINE = re.compile(
    r"^(?P<pre>T\s*P\s*[O0Q]|P\s*S\s*L|T\s*R\s*O)[\s\-._:&=]*(?P<num>[0-9A-Za-z]{3,14})"
    r"(?P<tail>\s*[&\s]+\d{1,4})?\s*$",
    re.I,
)

_CODE_ANY = re.compile(
    r"(?P<pre>T\s*P\s*[O0Q]|P\s*S\s*L|T\s*R\s*O)[\s\-._:&=]*(?P<num>[0-9A-Za-z]{3,14})"
    r"(?P<tail>\s*[&\s]+\d{1,4})?",
    re.I,
)

_PLATE = re.compile(
    r"\b(?P<j>B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|"
    r"HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)"
    r"[\s\-]*(?P<n>[0-9OIl]{2,3})[\s\-]*(?P<s>[A-Z]{2,3})\b",
    re.I,
)

_PLATE_LOOSE = re.compile(
    r"[!]?\b(?P<j>B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|"
    r"HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)"
    r"[\s\-]+(?P<n>[0-9OIlzstZtg]{2,3})[\s\-]+(?P<s>[A-Z]{2,3})\b",
    re.I,
)

_DATE = re.compile(
    r"\b(?P<d>\d{1,2})[./\-:](?P<m>\d{1,2})[./\-:](?P<y>\d{2,4})\b"
)

_QTY = re.compile(
    r"(?<!\d)(?P<a>\d{1,3})[.,](?P<b>\d{3})(?:[.,](?P<c>\d{1,2}))?(?!\d)"
)

_JUNK_LINE = re.compile(
    r"^(?:all|pee|ane|are|the|and|for|fouls|cards|discipline|yellow|won|1s1|d|ctrl|nee|ist)\s*$",
    re.I,
)

_LEXICON: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"bucur[aeik]+(?:s?t[il1]?|aki)?", re.I), "Bucuresti"),
    (re.compile(r"\bcl[uy][ijy]\b", re.I), "Cluj"),
    (re.compile(r"neamt[i1l]+u?", re.I), "Neamtiu"),
    (re.compile(r"m[i1l]+[il1]+t(?:ar[i1l]?|tei)", re.I), "Militari"),
    (re.compile(r"bol[i1l]+nt[i1l]+n[\-\s]?deal", re.I), "Bolintin-Deal"),
    (re.compile(r"(?:[i1l]+ul[i1l]+u|vliu|vli[vu])\s*man[i1l]+[vu]?", re.I), "Iuliu Maniu"),
    (re.compile(r"\bb[vu]d\.?\b", re.I), "Bd."),
    (re.compile(r"\bg[aă4]le[tț][i1l]?\b", re.I), "GALETI"),
    (re.compile(r"\bsac(?:i|/i)?\b", re.I), "Sac"),
    (re.compile(r"\bdacia\b", re.I), "Dacia"),
]

# HTR latin-extended charset includes Cyrillic; CRNN often emits lookalike glyphs
# (ТPO instead of TPO). Fold to Latin so code/plate regexes still match.
_CYR_LOOKALIKES = str.maketrans(
    {
        "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
        "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X",
        "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
        "І": "I", "і": "i", "Ѕ": "S", "ѕ": "s",
    }
)


def fold_cyrillic_lookalikes(text: str) -> str:
    if not text:
        return text
    return text.translate(_CYR_LOOKALIKES)


def normalize_code_number(num: str) -> str:
    repl = {"O": "0", "o": "0", "Q": "0", "I": "1", "l": "1", "L": "1", "i": "1", "Z": "2", "z": "2"}
    repaired = "".join(repl.get(ch, ch) for ch in num)
    cleaned = "".join(ch for ch in repaired if not (ch.isalpha() and ch.islower()))
    if any(ch.isalpha() for ch in cleaned):
        return cleaned
    return "".join(ch for ch in cleaned if ch.isdigit())


def _prefix_canon(pre: str) -> str:
    p = re.sub(r"\s+", "", pre.upper()).replace("TPQ", "TPO").replace("TP0", "TPO")
    if p.startswith("PS"):
        return "PSL"
    if p.startswith("TR"):
        return "TRO"
    return "TPO"


def _format_code(pre: str, num: str, tail: str | None = None) -> str:
    digits = normalize_code_number(num)
    if tail:
        extra = re.sub(r"\D", "", tail)
        if extra:
            digits = digits + extra
    if len(digits) < 4:
        return ""
    return f"{_prefix_canon(pre)}-{digits}"


def fix_code_line(text: str) -> str:
    raw = text.strip()
    m = _CODE_LINE.match(raw)
    if m:
        got = _format_code(m.group("pre"), m.group("num"), m.group("tail"))
        return got or text
    m2 = _CODE_ANY.search(raw)
    if not m2:
        return text
    got = _format_code(m2.group("pre"), m2.group("num"), m2.group("tail"))
    if not got:
        return text
    return raw[: m2.start()] + got + raw[m2.end() :]


def fix_plate(text: str) -> str:
    def repl(m: re.Match[str]) -> str:
        j = m.group("j").upper()
        n = normalize_code_number(m.group("n"))
        s = m.group("s").upper().replace("0", "O")
        if s == "VEM":
            s = "VFM"
        if len(n) < 2 or len(s) < 2:
            return m.group(0)
        return f"{j}-{n}-{s}"

    out = _PLATE.sub(repl, text)
    if out == text:
        out = _PLATE_LOOSE.sub(repl, text)
    return out


def fix_date(text: str) -> str:
    def repl(m: re.Match[str]) -> str:
        d, mo, y = m.group("d"), m.group("m"), m.group("y")
        if len(y) == 2:
            y = "20" + y
        if len(y) == 4 and y.startswith("1") and y[1] in "012":
            y = "2" + y[1:]
        try:
            di, mi, yi = int(d), int(mo), int(y)
            if not (1 <= di <= 31 and 1 <= mi <= 12 and 2000 <= yi <= 2099):
                return m.group(0)
        except ValueError:
            return m.group(0)
        return f"{di:02d}.{mi:02d}.{yi}"

    return _DATE.sub(repl, text)


def _already_canon(t: str) -> str | None:
    up = t.upper()
    for canon in _CANON_HEADS:
        if up.startswith(canon.upper()):
            return canon
    return None


def fix_labels(text: str) -> str:
    t = text.strip()
    # Glued TIPM4RE / CANTMARFA
    t = re.sub(r"^TIP\s*M\s*[A4]\s*R\s*[FE]\b", "TIP MARFA", t, count=1, flags=re.I)
    t = re.sub(r"^CANT\s*M\s*[A4]\s*R\s*F\s*[AĂ]?\b", "CANT MARFA", t, count=1, flags=re.I)

    existing = _already_canon(t)
    if existing:
        rest = t[len(existing) :].lstrip(" .:-!")
        # Strip one duplicated value-label (M4RFA: / MARFA:)
        rest = re.sub(
            r"^(?:M\s*[A4]\s*R\s*F\s*[AĂ]?|MARF[AĂ]|UMENT)\s*:?\s*",
            "",
            rest,
            count=1,
            flags=re.I,
        )
        return f"{existing}: {rest}" if rest else existing

    for pat, canon in _LABEL_FIXES:
        if not pat.search(t):
            continue
        t2 = pat.sub(canon, t, count=1)
        rest = t2[len(canon) :].lstrip(" .:-!")
        rest = re.sub(
            r"^(?:M\s*[A4]\s*R\s*F\s*[AĂ]?|MARF[AĂ]|UMENT)\s*:?\s*",
            "",
            rest,
            count=1,
            flags=re.I,
        )
        return f"{canon}: {rest}" if rest else canon
    return text


def fix_lexicon(text: str) -> str:
    out = text
    for pat, canon in _LEXICON:
        out = pat.sub(canon, out)
    return out


def fix_qty_tokens(text: str) -> str:
    def repl(m: re.Match[str]) -> str:
        a, b, c = m.group("a"), m.group("b"), m.group("c")
        if c is None:
            return f"{a}.{b}"
        return f"{a}.{b},{c}"

    return _QTY.sub(repl, text)


def normalize_ro_line(text: str) -> str:
    if not (text or "").strip():
        return text
    t = fold_cyrillic_lookalikes(text.strip())
    t = fix_code_line(t)
    t = fix_labels(t)
    t = fix_plate(t)
    t = fix_date(t)
    t = fix_lexicon(t)
    t = fix_qty_tokens(t)
    return t


def normalize_ro_lines(lines: Iterable[str]) -> list[str]:
    return [normalize_ro_line(x) for x in lines]


def _stitch_continuations(lines: list[str]) -> list[str]:
    if not lines:
        return lines
    out: list[str] = [lines[0]]
    for ln in lines[1:]:
        s = ln.strip()
        prev = out[-1]
        if _JUNK_LINE.match(s):
            continue
        if re.match(r"^[&\s]*\d{2,4}$", s) and re.search(r"\b(?:TPO|PSL|TRO)-\d+", prev, re.I):
            out[-1] = fix_code_line(f"{prev} {s}")
            continue
        # Only stitch known split-route crumbs onto RUTA/TRANS lines
        if (
            len(s) <= 5
            and " " not in s
            and re.search(r"^(?:RUTA|TRANS)\b", prev, re.I)
            and re.match(r"^(?:TARI|MILITARI|MIN|MICI)$", s, re.I)
        ):
            out[-1] = normalize_ro_line(f"{prev} {s}")
            continue
        out.append(ln)
    return out


def _drop_background_noise(lines: list[str]) -> list[str]:
    kept = []
    for ln in lines:
        s = ln.strip()
        if len(s) <= 1:
            continue
        if _JUNK_LINE.match(s):
            continue
        kept.append(ln)
    return kept if kept else lines


def normalize_ro_document(text: str) -> str:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    lines = _drop_background_noise(lines)
    lines = normalize_ro_lines(lines)
    lines = _stitch_continuations(lines)
    lines = normalize_ro_lines(lines)
    return "\n".join(lines).strip()


def merge_ro_documents(*blobs: str) -> str:
    """Union of strong logistics lines from several OCR passes (ink + scan)."""
    strong: list[str] = []
    seen: set[str] = set()
    code_re = re.compile(r"\b(?:TPO|PSL|TRO)-\d{4,}", re.I)
    date_re = re.compile(r"\b\d{1,2}\.\d{1,2}\.20[2-3]\d\b")
    plate_re = re.compile(
        r"\b(?:B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|"
        r"HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)"
        r"-\d{2,3}-[A-Z]{3}\b",
        re.I,
    )
    label_re = re.compile(
        r"^(?:DATA|NR\. AUTO|NR\. CURSE|NR\. DOCUMENT|RUTA|TIP MARFA|CANT MARFA|"
        r"GREUTATE|EXPEDITOR|ADRESA|AVIZ|COMANDA)\b",
        re.I,
    )

    def is_strong(ln: str) -> bool:
        s = ln.strip()
        if not s or _JUNK_LINE.match(s):
            return False
        return bool(
            code_re.search(s)
            or date_re.search(s)
            or plate_re.search(s)
            or label_re.search(s)
            or re.search(r"\d+[.,]\d{3}", s)
        )

    # Prefer earlier blobs' order; append new strong lines from later passes
    for blob in blobs:
        for ln in normalize_ro_document(blob or "").splitlines():
            key = re.sub(r"\s+", " ", ln.strip().upper())
            # Dedup by label head or full line
            head = key.split(":", 1)[0].strip()
            dedup_key = head if label_re.match(ln.strip()) else key
            if dedup_key in seen:
                # Replace weaker date/code with stronger if same label
                if label_re.match(ln.strip()):
                    for i, prev in enumerate(strong):
                        if prev.upper().startswith(head + ":") or prev.upper().startswith(head + " "):
                            # Keep the one with a valid date / longer code
                            prev_score = (2 if date_re.search(prev) else 0) + (2 if code_re.search(prev) else 0) + len(prev)
                            new_score = (2 if date_re.search(ln) else 0) + (2 if code_re.search(ln) else 0) + len(ln)
                            if new_score > prev_score:
                                strong[i] = ln.strip()
                            break
                continue
            if is_strong(ln):
                seen.add(dedup_key)
                strong.append(ln.strip())
    return "\n".join(strong).strip()
