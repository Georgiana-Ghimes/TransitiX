#53 Rută: fragment client („Ibutie Srl” / „Uct Srl”)

`STREET_TYPE_RE` matched bare `str` inside `DISTRIBUTIE` / `CONSTRUCT`, so the
tail (`ibutie srl`, `uct srl`) became the street name and format defaulted to `Str.`.

Fix: type tokens need letter lookarounds (not `\b`, so `str.` still matches).
