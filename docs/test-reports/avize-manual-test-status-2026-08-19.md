# Avize manual test status — TransitiX 1.8.1

**Date:** 2026-08-19  
**Tester:** manual browser validation on local main  
**Scope:** Avize / Rapoarte P1 UX polish, P2 RAI defaults, P3 follow-ups

## Summary

| Metric | Value |
|--------|-------|
| App version under test | 1.8.1 |
| Manual checklist steps | 14 |
| Passed | 13 |
| Blocked | 1 |
| Failed | 0 |
| Open follow-ups after P1 | 4 |

**Verdict:** P1 UX polish is ready to ship. P2 is mostly confirmation of existing defaults. P3 still needs HTTP-route tests and explicit upload tenant isolation check.

## Current status by area

| Area | Status | Meaning |
|------|--------|---------|
| P1 UX polish | Verified | Bulk confirm lock, preset highlight, export/zip de-duplication, preview polish tested locally. |
| P2 RAI gates | Needs confirmation | Behavior is already implemented; what remains is product/RAI confirmation for R1–R5 defaults. |
| P3 tests / security | Open | Still needs HTTP-route coverage and a final upload isolation check on latest main. |

## RAI gates to confirm

| Gate | Question | Current default | Status in code |
|------|----------|-----------------|----------------|
| R1 | TPO duplicat permis? | Avertizează și lasă salvarea | Implemented and visible in UI. |
| R2 | Format rută în Excel | Excel = Client → Livrare; ruta_display doar UI | Implemented with separate office alias. |
| R3 | Sumă factură | User chooses valoare TPO or km × tarif | Implemented via amount-rule selector and API. |
| R4 | OCR poză obligatoriu go-live? | Nu; PDF text stays default path | Vision path exists; go-live requirement is a business decision. |
| R5 | Split un PDF in 2 rânduri? | Nu, până cere explicit RAI | Not implemented by design. |

## Already verified

| Check | Result |
|-------|--------|
| Search filters | Search is URL-encoded normally; date presets filter by `data_efectuare_cursa`, not upload date. |
| Confirmă selectate | Only triggers for selected rows that are not already confirmed; re-click spam no longer creates duplicate requests. |
| Unește / Zip | Buttons are disabled while busy so heavy actions cannot be double-triggered from rapid clicks. |
| Preview auth | Edit modal preview fetches upload blobs with Authorization instead of storing JWT in the preview URL. |
| Preset highlight | Azi / Săptămâna asta / Luna asta now show active styling and reset correctly. |
| TPO duplicate warning | Saving a second row with the same TPO warns but still allows both rows to exist. |

## Manual test checklist

Legend: **P** = Passed, **F** = Failed, **B** = Blocked, **R** = Needs retest

| # | Status | Action | Expected result |
|---|--------|--------|-----------------|
| 1 | P | Open `/avize` as office user | Page loads with version 1.8.1 and no full-page error. |
| 2 | P | Upload a text PDF | Row appears with source badge Text PDF; status is Extras unless extraction fell back to stub. |
| 3 | B | Upload a photo / text-poor file | Source badge becomes Vision when `GOOGLE_VISION_API_KEY` is configured and billing is enabled; otherwise Stub/manual path. Blocked: Google Cloud project requires billing for Vision API. |
| 4 | P | Edit a row and save office-only fields | Km, taxe, tarif, observatii, and ruta birou persist after save + refresh. |
| 5 | P | Click Re-extrage on an edited row | TPO/date/auto/ruta/document refresh from file; office alias and manual office fields keep intended behavior. |
| 6 | P | Select multiple unconfirmed rows, then click Confirmă selectate once | Selected rows become Confirmat and the button disables when no unconfirmed selections remain. |
| 7 | P | Spam Confirmă selectate after confirmation | No duplicate `POST /api/avize/bulk-confirm` requests are sent. |
| 8 | P | Select rows and spam Unește / Zip | Only one export/zip request is active at a time. |
| 9 | P | Open Editează on desktop | PDF preview is tall, scrollable, and visually cleaner inside the modal. |
| 10 | P | Save a duplicate TPO | Warning appears; save is still allowed. |
| 11 | P | Set ruta birou and export XLSX | UI can show office alias, but Excel still uses `ruta_transport` (Client → Livrare). |
| 12 | P | Create draft invoice twice: once with valoare TPO, once with km × tarif | Both rules produce a draft in Financiar; no ANAF behavior is implied. |
| 13 | P | Open Rapoarte tab after export | Export log includes Cine / user information and report tables render. |
| 14 | P | Open a TripDetail linked to an aviz | Linked avize section is visible for the trip. |

## Still open after P1

| Topic | What still remains |
|-------|-------------------|
| P2 confirmation | Someone still needs to explicitly confirm or keep the current defaults for R1–R5 in the planning docs. |
| P3 route tests | No HTTP-level coverage yet for list filters, duplicate_tpo on save/update, bulk-confirm, locked RAI template, and draft-invoice constraints. |
| Upload tenant isolation | Latest main claims cross-tenant upload protection; this still deserves one explicit manual or automated cross-company check. |
| Vision go-live gate | Photo OCR path exists, but production expectation depends on whether RAI requires it for go-live. |

## Source documents

- `docs/next-improvements.plan.md` — P2 and P3 backlog
- `docs/avize-planning-checklist.md` — R1–R5 decision table
- `docs/changes/1.7.0-avize-increments.md` — increments A–E shipped
- `docs/changes/1.8.1-avize-export-actor.md` — recent Avize follow-up on main
- `docs/changes/1.8.2-p1-avize-ux-polish.md` — P1 polish shipped in this increment
