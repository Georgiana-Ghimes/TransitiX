# ClickUp pack — Spec V2 + Avize (română)

## What

Two ClickUp pages in Romanian, one H1 each (the previous multi-H1 HTML import collapsed into a single English page).

- `docs/clickup/spec-mvp-v2-ro.md` (+ `.html`) — **Spec MVP - Transitix V2**
- `docs/clickup/avize-stare-si-plan-ro.md` (+ `.html`) — **Avize - Stare curentă și plan de dezvoltare**
- Import steps: `docs/clickup/00-import-without-deleting.md`

Regenerate HTML: `node docs/clickup/build-html.mjs`

## Verify

1. Open the existing ClickUp page (do not import onto the 2024 Spec MVP).
2. Import **Markdown** or **HTML without page splitting**.
3. Confirm one document per file, Romanian headings, tables readable.
4. Old wiki pages still in the sidebar.
