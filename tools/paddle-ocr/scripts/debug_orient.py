import numpy as np
from PIL import Image
import app

img = Image.open("/tmp/hw.jpg").convert("RGB")
base = app.correct_perspective(img)
print("base size", base.size)
cands = []
for deg in [0, 90, 270, 180]:
    frame = base if deg == 0 else base.rotate(-deg, expand=True)
    prepared = app.emphasize_ink(frame)
    text, confs = app.ocr_array(np.array(prepared))
    score = app._score_frame(text, confs, frame)
    labels = len(app._HW_LABEL_RE.findall(text or ""))
    has_code = bool(app._CODE_RE.search(text or ""))
    signal = int(has_code) * 20 + labels * 5
    upright = 2 if deg == 0 else (1 if deg in (90, 270) else 0)
    rank = (0, upright, score) if signal == 0 else (signal, score, upright)
    print(
        f"deg={deg} score={score:.2f} labels={labels} code={has_code} "
        f"signal={signal} upright={upright} rank={rank} chars={len(text)} "
        f"head={text[:70]!r}"
    )
    cands.append((deg, rank, text[:70]))
best = max(cands, key=lambda c: c[1])
print("CHOSEN", best[0], "rank", best[1])
