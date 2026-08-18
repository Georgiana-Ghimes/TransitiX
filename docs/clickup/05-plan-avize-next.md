# Plan — Avize / Rapoarte next increments

**Baseline:** 1.3.0 (manual checklist passed for text-layer PDFs; Editează persist; Unește + templates)  
**Principle:** finish the RAI annex loop before building a general reports product. Do not bundle GPS / e-Factura / Planning AI into these increments.

Effort is T-shirt (S/M/L) for one implementer who already knows this repo.

## North star (when Avize is “100%” for RAI)

A dispatcher can:

1. Drop a week of avize (PDF and phone photo).
2. See low-confidence fields highlighted.
3. Fix a short queue (not re-type the whole annex).
4. Apply RAI observatii codes and template defaults.
5. Export Anexa XLSX **and** optionally email it or attach it to a draft invoice.
6. Find any TPO later without scrolling 200 unsorted rows.

Until that list is true, keep the page titled Avize / Rapoarte but treat **Rapoarte** as a later tab.

---

## Increment A — 1.3.x polish (parser + list UX)

**Goal:** fewer Editează clicks on real client avize; list stays usable as volume grows.  
**Size:** M  
**Depends on:** more real PDFs from RAI (do not commit them).

### Stories

- Street abbreviations: `Blvd`, `Bld`, `Aleea`, `Al.`, `Pța` / `Piata` if they appear on avize.
- Optional office-style rută **display** (e.g. `Bol-Domnesti/…`) as a **toggle or second field**, without destroying the Client→Livrare parse (testers must choose the format).
- List filters: date from/to, status, text search (TPO, auto, document, filename).
- Duplicate warning when `numar_tpo` already exists in the company.
- Show extract provider on the row (`pdf-text` / `vision` / `stub`) so Încărcat is explainable.
- Preview file in Editează (iframe/pdf.js or new tab). New tab is enough for S.

### Acceptance

- New layouts that only failed on `Blvd` parse without a full rewrite.
- Filter + search work on phone.
- Duplicate TPO: warn, still allow save (transfers can repeat? confirm with RAI).
- No regression: Editează still persists; Re-extrage still overwrites from file.

### Out of scope

- New XLSX report types
- Vision key as a product requirement (optional env)

---

## Increment B — 1.4 office workflow

**Goal:** the annex is a weekly ritual, not a one-off export.  
**Size:** L

### Stories

- Date presets: today / this week / this month (Bucharest TZ).
- Bulk Confirmă selected rows.
- Observații helper: saved company codes (e.g. `Z:B*`) as chips; still editable.
- Email annex: Resend attachment when keys exist; otherwise download-only + toast (same pattern as invoices).
- Keep original files: zip download of selected PDFs next to XLSX (PII stays on their server).
- Optional `numar_curse` default 1 already exists; allow “split aviz” later if RAI needs two rows per PDF — only if they ask.

### Acceptance

- Dispatcher confirms 20 rows without opening each modal.
- Codes appear in Excel Observatii column.
- Email path documented in Setări or Avize legend (configured vs stub).

---

## Increment C — 1.5 OCR quality (photos + more layouts)

**Goal:** Foto and scanned PDFs are first-class when Vision is configured.  
**Size:** L  
**Risk:** cost and accuracy; keep pdf-text as default.

### Stories

- `GOOGLE_VISION_API_KEY` runbook in VM Steps / this pack (no secrets in git).
- Rasterize text-poor PDFs before Vision (deferred in 1.3.0).
- Field-level confidence: highlight Auto/Rută/TPO when missing or garbage.
- Second layout pack only after 10+ non-Baumit samples (other clients). Do not guess.

### Acceptance

- Checklist U5 (Foto) becomes Pass or a documented limitation.
- Stub rows only when both text layer and Vision failed.
- Unit tests stay on synthetic fixtures; real PDFs stay local.

---

## Increment D — 1.6 connect to Curse and Financiar

**Goal:** annex is not an island.  
**Size:** L  
**Do not start before A–B feel good in RAI’s week.**

### Stories

- Optional `trip_id` / plate match suggestion (“this auto had a trip that day”).
- “Create draft invoice from selected confirmed avize” (sum valoare TPO or km×tarif — **RAI must pick the rule**).
- Still no silent ANAF send.

### Acceptance

- Link is optional; export still works unlinked.
- Invoice draft is reviewable in Financiar.
- e-Factura remains the existing simulation until its own project.

---

## Increment E — 1.7 Rapoarte (the rest of the page name)

**Goal:** more than one annex template type.  
**Size:** L  
**Only after D or if RAI asks for km/month reports first.**

### Candidates (pick with the client, do not build all)

- Km / tarif monthly per plate
- Avize count per client / per week
- Saved “report run” history (who exported what)
- Second template family (not Anexa) with its own Default columns

### Acceptance

- New tab **Rapoarte** or a report-type switch that cannot accidentally overwrite Anexa Factura RAI.
- Templates remain company-scoped.

---

## Suggested sequence

```
1.3.0 baseline (done)
    → A polish (parser + filters)     next
    → B weekly workflow (bulk, codes, email)
    → C Vision / scans
    → D trips / invoices
    → E extra reports
```

Parallel only if two people: A can overlap C (parser vs Vision) if they do not fight over `avizOcr.js` without a split (text parser vs `callVision*`).

## Explicitly later (platform, not Avize)

- Live GPS
- Real Planning LLM
- ANAF e-Factura XML
- Warehouse movements from aviz lines

## Decision log (fill in ClickUp comments)

| Question | Default until RAI answers |
|----------|---------------------------|
| Duplicate TPO allowed? | Warn, allow |
| Rută format in Excel | Keep Client→Livrare string; optional alias later |
| Invoice amount | Human-edited valoare TPO / km×tarif, not silent PDF totals |
| Photo OCR required for go-live? | No; text PDF is the 1.3.0 path |

## Engineering notes for the next agent

- Prefer stored office fields; never re-enable repair-on-every-load.
- `pdf-parse` XRef: keep retries.
- Do not commit `server/uploads/*` client files.
- Tests: `server/src/lib/avizOcr.test.js`, `avizExport.test.js`.
- Docs: CHANGELOG + `docs/changes/` for each increment.
