"""Designated-field checks on OCR text (sidecar-side needs_review).

Required fields block needs_review; optional fields (ruta/adresa) are warnings only.
paddle_fallback lines must still count as present when their text matches a pattern.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Iterable

# Built-in patterns for Romanian logistics docs (aviz / carnet).
_FIELD_PATTERNS: dict[str, re.Pattern[str]] = {
    "numar_aviz": re.compile(
        r"(?:aviz\s+de\s+expedi[tț]ie|nr\.?\s*(?:aviz|document)|aviz(?:\s*nr)?)"
        r"\s*[:.\s]*([A-Z]{2,4}[\s\-]*[0-9]{4,})",
        re.I,
    ),
    "tpo": re.compile(r"\bTPO[\s\-._]*[0-9OIl]{4,}\b", re.I),
    "tro": re.compile(r"\bTRO[\s\-._]*[0-9OIl]{4,}\b", re.I),
    "psl": re.compile(r"\bPSL[\s\-._]*[0-9OIl]{4,}\b", re.I),
    "data": re.compile(
        r"\b(?:data|dat[aă])(?:\s+\w+){0,4}\s*[:.\s]*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})"
        r"|\b(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b",
        re.I,
    ),
    "numar_inmatriculare": re.compile(
        r"\b(?:B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|"
        r"HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN)"
        r"[\s\-]?[0-9]{2,3}[\s\-]?[A-Z]{3}\b",
        re.I,
    ),
    "cantitate": re.compile(
        r"(?:cant(?:itate)?(?:\s*marf[aă])?|greutate|kg|tone?|qty|quantity)"
        r"\s*[:.\s]*([\d]+(?:[.,]\d+)*)"
        r"|([\d]+[.,]\d{3}(?:[.,]\d+)?)\s*(?:kg|t\b|tone)",
        re.I,
    ),
    "semnatura": re.compile(r"semn[aă]tur[aă]|semnat|signature", re.I),
    "ruta": re.compile(r"rut[aă]\s*(?:trans)?\s*[:.\s]*\S+", re.I),
    "adresa": re.compile(r"(?:adres|bud\.?|str\.?|calea)\s*[:.\s]*\S+", re.I),
}

# Aliases so REQUIRED_FIELDS can say numar_aviz or tpo interchangeably for carnets.
_ALIASES: dict[str, tuple[str, ...]] = {
    "numar_aviz": ("numar_aviz", "tpo", "tro", "psl"),
    "document": ("numar_aviz", "tpo", "tro", "psl"),
}


def _parse_list(env_val: str, default: tuple[str, ...]) -> list[str]:
    raw = (env_val or "").strip()
    if not raw:
        return list(default)
    return [p.strip().lower() for p in raw.split(",") if p.strip()]


def required_fields() -> list[str]:
    return _parse_list(
        os.environ.get("REQUIRED_FIELDS", ""),
        ("numar_aviz", "data", "numar_inmatriculare", "cantitate"),
    )


def optional_fields() -> list[str]:
    return _parse_list(
        os.environ.get("OPTIONAL_FIELDS", ""),
        ("ruta", "adresa", "semnatura"),
    )


@dataclass
class FieldCheckResult:
    needs_review: bool
    missing_fields: list[str] = field(default_factory=list)
    low_confidence_fields: list[str] = field(default_factory=list)
    found: dict[str, str] = field(default_factory=dict)


def _match_field(name: str, text: str) -> str | None:
    keys = _ALIASES.get(name, (name,))
    for key in keys:
        pat = _FIELD_PATTERNS.get(key)
        if not pat:
            continue
        m = pat.search(text or "")
        if m:
            return (m.group(0) or "").strip()
    return None


def check_fields(
    text: str,
    *,
    required: Iterable[str] | None = None,
    optional: Iterable[str] | None = None,
    low_conf_field_names: Iterable[str] | None = None,
) -> FieldCheckResult:
    """Return missing required fields; optional never force needs_review alone."""
    req = list(required) if required is not None else required_fields()
    opt = list(optional) if optional is not None else optional_fields()
    low = set(low_conf_field_names or ())

    found: dict[str, str] = {}
    missing: list[str] = []
    low_list: list[str] = []

    for name in req:
        hit = _match_field(name, text)
        if hit:
            found[name] = hit
            if name in low:
                low_list.append(name)
        else:
            missing.append(name)

    for name in opt:
        if name in found or name in missing:
            continue
        hit = _match_field(name, text)
        if hit:
            found[name] = hit
            if name in low:
                low_list.append(name)
        else:
            # optional absent → not missing_fields
            pass

    needs = bool(missing)
    if os.environ.get("NEEDS_REVIEW_ON_LOW_CONF", "0").strip() in ("1", "true", "True"):
        needs = needs or bool(low_list)

    return FieldCheckResult(
        needs_review=needs,
        missing_fields=missing,
        low_confidence_fields=low_list,
        found=found,
    )
