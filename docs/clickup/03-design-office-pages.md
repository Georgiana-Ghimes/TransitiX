# Design — current office pages

**Date:** 19 Aug 2026 · version 1.3.0  
**Purpose:** as-built design notes for pages that already exist, so Avize work stays consistent and the MVP rewrite has a page inventory.

Maturity: **Live** = used with real data patterns; **Demo** = labeled fake integration; **Baseline** = new, tested, still expanding.

## Inventory

| Page | Path | Maturity | Primary job | Layout pattern | Known gaps (not Avize) |
|------|------|----------|-------------|----------------|------------------------|
| Login / Register / Forgot / Reset | `/login` … | Live | JWT session | AuthLayout, navy brand | — |
| Dashboard | `/` | Live | Counts, recent curse, expiry, status bars | KPI row + chart + lists | Expiry alerts computed in the browser from lists |
| Curse | `/trips` | Live | List/filter trips, create | Table md+ / cards phone, TripForm modal | — |
| Detaliu cursă | `/trips/:id` | Live | Assign, CMR OCR, confirm link | Detail sections | Email of link is stub without Resend |
| Flotă | `/vehicles` | Live | Cards, deactivate / reactivate / delete | Card grid | — |
| Șoferi | `/drivers` | Live | Same card pattern | Card grid | Inactive: Reactivează / Șterge |
| Tracking GPS | `/gps` | Demo | Map of last points | Full-width map + side list | Simulate movement only |
| Planning AI | `/planning` | Demo | Suggestion cards | Cards + “Analizează” | Stub JSON, not an optimizer |
| Clienți | `/clients` | Live | CRM-lite | Cards + ClientForm | — |
| Financiar | `/finance` | Live + demo e-Factura | Invoices, CSV, mark paid/sent | KPI + table | ANAF is local status only |
| Depozit | `/warehouse` | Live | Products / stock | Table/cards + form | Not tied to aviz marfă |
| Documente | `/documents` | Live | Expiry list | Grouped alerts | Horizon from Setări |
| Avize / Rapoarte | `/avize` | Baseline | See dedicated design page | Toolbar + legend + table/cards + templates tab | Next-increment plan |
| Setări | `/settings` | Live | Company + expiry days | Form, admin save | — |
| App Șofer | `/driver-app` | Live | Assigned trips, photo, chat-ish | Mobile-first, no office nav | — |
| Portal client | `/confirm/:token` | Live | Confirm delivery | Public, token | — |

## Cross-page UX rules already in the app

- Destructive actions use **ConfirmDialog** (Flotă, Avize Șterge, etc.).
- List create/edit uses **ModalShell** + existing `*Form` components.
- Search is **GlobalSearch** → `/api/search`, not a full catalog download.
- Notifications: bell, poll when the tab is visible.

## Visual consistency checklist for any new page

1. Title + one-line subtitle (what the page is for).
2. Primary actions in a wrapping toolbar, equal control height.
3. Empty state: icon + one sentence + the action to take.
4. Phone cards first, table from `md`.
5. Toasts on success/failure; no silent save.

## Pages that Avize should eventually connect to (not built)

- **Curse:** optional `trip_id` on an aviz after the parser is trusted.
- **Financiar:** generate or attach an invoice from a confirmed annex batch.
- **Depozit:** do **not** auto-move stock from aviz qty in the next increment (easy to get wrong).

GPS, Planning, and e-Factura stay demos until a dedicated increment. Avize work should not wait on them.
