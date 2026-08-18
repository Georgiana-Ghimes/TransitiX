# Spec MVP — Transitix 2026 (as-built)

**Status:** living spec (rewritten 19 Aug 2026 from the running app, not a restatement of the 2024 ClickUp page)  
**App version described:** 1.3.0  
**Audience:** product, office testers, implementation

The 2024 **Spec MVP - Transitix** page stays in ClickUp as history. This page is what the product **is today**, what is still a demo, and what “done” means for the next office-usable slice (RAI Avize / Rapoarte).

## 1. Product

Transitix is a multi-tenant TMS for Romanian road freight: office users run trips (CMR), fleet, drivers, clients, warehouse, documents, and invoices; drivers use a separate app; clients confirm delivery via a token link.

**First paying workflow to harden:** RAI Spedition’s monthly **Anexa Factură** from Baumit-style avize (PDF/photo) → reviewed table → one XLSX. That is **Avize / Rapoarte**. It is a **solid baseline**, not the finished reports product.

## 2. Users and access

| Role | Where they work | Notes |
|------|-----------------|--------|
| Admin / dispatcher / finance (office) | Sidebar app | Full office nav. Company profile writes are admin-only. |
| Driver | `/driver-app` only | No office sidebar. Assigned trips, CMR photo, status. |
| Client (no login) | `/confirm/:token` | Delivery confirmation. |

Isolation: every company-scoped query uses `company_id`. Do not leak rows across tenants.

## 3. Stack (current)

- Frontend: React + Vite + Tailwind (`src/`), JWT in `AuthContext`
- API: Express (`server/`), Postgres
- Local: API `:3001`, Vite `:5173` (proxy `/api` and `/uploads`), Docker Postgres host **5434**
- No Base44 SDK (removed). Do not reintroduce it.

## 4. Shipped vs demo vs next

### Shipped (usable in office, with known limits)

- Auth: login, register, forgot/reset password; refresh token; login rate limit
- Dashboard, Curse + trip detail, Flotă, Șoferi, Clienți, Depozit, Documente, Setări
- Driver app + client confirmation link
- Invoices in Financiar (status, CSV export, email if Resend is configured)
- Company settings (name, CUI, expiry-alert days)
- Global search (server `/api/search`)
- **Avize / Rapoarte 1.3.0 baseline** — see design + plan pages

### Labeled demos / stubs (must not be sold as live integrations)

| Area | What the UI does today |
|------|------------------------|
| Tracking GPS | Leaflet map + simulated positions, not a GPS vendor |
| Planning AI | Stub suggestions (`InvokeLLM` is not a real optimizer) |
| ANAF e-Factura | Button marks `efactura_status = sent` locally |
| Email | Resend when keys exist; otherwise console / local reset link |
| CMR OCR | Google Vision if `GOOGLE_VISION_API_KEY`; else prefill from the trip |
| Aviz photo OCR | Same Vision key; PDFs **with a text layer** parse without Vision |

### Explicitly not in this MVP rewrite

- Live telematics
- Real ANAF SPV / e-Factura XML
- LLM dispatch planning
- Emailing the Anexa to the client from Avize (not wired)
- Auto-coding Observații from product lines
- Linking each aviz row to a Curse trip or a Factură
- Generic “all reports” beyond the Anexa XLSX

## 5. Office information architecture

| Nav label | Path | Job |
|-----------|------|-----|
| Dashboard | `/` | KPIs, recent trips, expiry glance, status chart |
| Curse | `/trips`, `/trips/:id` | Plan/assign CMR trips; CMR OCR; confirmation link |
| Flotă / Șoferi / Clienți | `/vehicles` `/drivers` `/clients` | Cards; deactivate / reactivate |
| Tracking GPS | `/gps` | Demo map |
| Planning AI | `/planning` | Demo suggestions |
| Financiar | `/finance` | Invoices |
| Depozit | `/warehouse` | Stock products |
| Documente | `/documents` | ITP, RCA, permis, … horizon from Setări |
| Avize / Rapoarte | `/avize` | Avize extract + Anexa XLSX |
| Setări | `/settings` | Company profile + alert days |

Responsive rule (all office pages): usable from ~360px. Cards below `md`, tables from `md` with horizontal scroll. Do not hide primary actions on phone.

## 6. Avize / Rapoarte — baseline definition of done (1.3.0)

This is **done enough to test with real RAI avize**, not done as a reports suite.

Office can:

1. Upload one or many Baumit-style PDFs (text layer) and get TPO, date, plates, route, qty, document number.
2. Edit all 13 annex fields; date / auto / rută / document **persist** after refresh (Re-extrage is the only “read the file again”).
3. Confirm, delete, re-extract.
4. Maintain XLSX templates (default **Anexa Factura RAI**, 14 columns A–N).
5. Select rows + the Avize-tab dropdown template → **Unește în Anexa XLSX**.
6. Template Default values (e.g. Taxă 100, Tarif km 20) fill Excel when the aviz field is empty or 0.

Parser rules locked in testing:

- **TPO** = `TPO-` + digits only (not MPI / Adeziv).
- **Rută** = Client street → Adresă de livrare (not Expeditor Site BOL/MIL except TRO fallback).
- **Auto** = tractor / trailer plates, never the full PDF dump.

Not in baseline: Vision-only scans without a key, email annex, trip/invoice link, extra report types, observatii autocompletes, pagination beyond 200 rows.

## 7. Success criteria

**MVP (platform):** office can run a fictional company end-to-end (seed admin) without Base44, with stubs clearly labeled.

**RAI office slice:** a dispatcher can turn a week of Baumit avize into an Anexa XLSX that matches the client sheet well enough to send after a human review of km / taxe / tarif / observații.

**Next slice** is specified on **Plan — Avize / Rapoarte next increments**. Do not expand GPS / e-Factura / Planning in the same increment unless the client blocks on them.

## 8. Constraints for all future work

- Keep `company_id` on company-scoped tables and queries.
- Changelog + `docs/changes/` + aligned `package.json` versions (`AGENTS.md`).
- Do not commit client PDFs or exported annexes (PII).
- Prefer existing entity API in `src/api/client.js`.
- Semver: patch = fix/docs; minor = user-visible Avize/reports features; major = breaking API/schema.
