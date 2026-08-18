# Design — Avize / Rapoarte

**Path:** `/avize`  
**Nav:** Avize / Rapoarte (clipboard icon)  
**Version:** 1.3.0 baseline  
**Code:** `src/pages/AvizeReports.jsx`, `server/src/routes/avize.js`, `server/src/lib/avizOcr.js`

This page is the new office surface. It is **not** a generic BI reports module yet. The name **Rapoarte** is the destination; **Avize → Anexa XLSX** is what shipped.

## 1. Job to be done

A dispatcher receives many Baumit (and similar) avize. They need one **Anexa Factură RAI** spreadsheet for billing, with columns the client already uses, without retyping every TPO, plate, and route.

Human remains in the loop for km, taxe, tarif, valoare TPO, and observații.

## 2. Information architecture

Two tabs (segmented control, top right):

- **Avize** — upload, review, confirm, export
- **Șabloane** — column maps for XLSX (the Avize-tab dropdown is what export actually uses)

In-page **Legendă acțiuni** / **Legendă șabloane**: `<details open>` so first-time testers see Confirmă vs Unește vs Re-extrage.

## 3. Avize tab — layout

### Toolbar (one wrap row)

Left → right, **same top edge and `h-10`:**

1. **Încarcă avize** (navy) — PDF/images, multiple files
2. **Foto** (outline) — `capture=environment`
3. **Template `<select>`** — current export template
4. **Unește în Anexa XLSX (n)** (green) — disabled until selection + template

Hint under the select only: *Exportul folosește acest șablon, inclusiv Default…*

Do not put long help in the toolbar; the legend owns that.

### Empty state

Clipboard icon, sentence to upload PDF/photo. Unește stays disabled.

### List

- **Phone:** cards — TPO or filename, auto · date, actions as text links.
- **Desktop:** table — checkbox, TPO, Data, Auto, Rută, Marfă, Document, Status, Acțiuni. Truncate + native `title` tooltip.

Statuses: **Încărcat** (stub/failed extract) → **Extras** → **Confirmat**. Confirmă hides after confirmed. Export does **not** require Confirmat (legend says so); Confirmă is the “ready for invoice” mark.

### Row actions

| Action | Behaviour |
|--------|-----------|
| Editează | Modal, 13 fields (`AVIZ_FORM_FIELDS`). Save persists; does not re-parse PDF. |
| Confirmă | `status = confirmed` |
| Re-extrage | `POST /api/avize/extract` on the stored file; **overwrites** TPO/date/auto/rută/qty/document from the file. Re-enter km/taxe. |
| Șterge | ConfirmDialog; no undo |

### Editează aviz modal

- Grid 1 col / 2 col from `sm`; Rută and Observații span 2.
- Date input for Data efectuare cursă.
- Salvează / Anulează. Anulează discards.

## 4. Șabloane tab — layout

- **Șablon nou** (navy, top right)
- Cards: name, column count, **implicit** badge, Editează / Șterge
- Editor modal: name, implicit checkbox, rows of Header / Sursă / Default, add/remove columns
- After save: template is selected on the Avize dropdown; user must Unește again to see Taxă/Tarif in Excel

Default seed per company: **Anexa Factura RAI** (14 columns, yellow header on export). Incomplete custom templates are **not** silently replaced by the 14-col default (1.3.0 fix).

## 5. Data and API (for designers / QA)

Tables: `aviz_documents`, `report_templates` (both `company_id`).

| API | Role |
|-----|------|
| `POST /api/avize/extract` | Create or re-extract |
| Entity `AvizDocument` list/update/delete | Grid + Editează |
| `GET/POST/PUT/DELETE /api/avize/templates` | Șabloane |
| `POST /api/avize/export` | XLSX download |
| `POST /api/avize/repair` | Fills **empty/garbage** fields from stored OCR; **must not** overwrite office edits. Page load uses list, not repair. |

Extract chain: PDF text (`pdf-parse`, retried) → Vision if key and needed → stub fields for manual fill.

## 6. Parser behaviour (product rules, not just engineering)

These are part of the design contract with RAI testers:

- **Număr TPO:** only `TPO-…`. Manual TPO in Editează is kept if the PDF has none.
- **Rută transport:** Client address (start) → Adresă de livrare (end). Not Expeditor Site Bolintin. Site MIL/BOL only if there is no Client street (TRO).
- **Număr auto:** tractor and trailer; never dump “DOCUMENT DE TEST…”.
- **Street types** in the parser are a small regex (`strada`, `str.`, `sosea`, `bulevardul`, `bd.`, `calea`, …). **`Blvd` is not matched yet** — next parser polish.
- Office shorthand like `Bol-Domnesti/Independentei121` is **not** auto-generated; users may type it in Editează and it must persist.

## 7. What “baseline” looks like on screen

Happy path:

1. Upload 2–3 PDFs → rows appear Extras (or Încărcat if text layer failed).
2. Spot-check rută/auto; Editează km/taxe.
3. Confirmă when the row is invoice-ready.
4. Tick rows, keep the right șablon in the dropdown, Unește.
5. Open XLSX: yellow headers, `dd.mm.yyyy` dates, Nr. crt 1…n, defaults for 0 taxe/tarif if the template says so.

## 8. Open UX debt (feed the plan, do not treat as bugs in 1.3.0)

- No date range / client / TPO filter; list cap 200.
- No duplicate-TPO warning.
- No preview of the original PDF beside Editează.
- Foto + Vision not proven in the manual checklist (U5 N/A).
- Observații is free text; no chip picker for RAI codes.
- “Rapoarte” tab does not exist — only Anexa export.
- Avize are not shown on Dashboard or trip detail.
