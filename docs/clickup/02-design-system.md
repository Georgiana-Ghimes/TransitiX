# Design system — office UI

**Applies to:** all office pages including Avize / Rapoarte  
**Reference implementation:** `src/components/Layout.jsx`, `src/pages/AvizeReports.jsx`

This is the as-built visual language. New Avize work should match it rather than invent a second product look.

## Colour

| Token | Hex | Use |
|-------|-----|-----|
| Navy | `#0A2B4E` | Sidebar, page titles, primary buttons, table TPO |
| Navy hover / links | `#1D4E89` | Secondary text buttons, focus border |
| Green | `#0A7A3E` | Constructive export (Unește), confirm-adjacent |
| Page ground | `#F8F9FA` | App background |
| Surface | white | Cards, tables, modals |
| Border | `slate-200` / `slate-200/80` | Cards, inputs |
| Danger | `red-500` | Șterge |

Do not introduce a second primary green/navy. Status colours stay badge-based (slate / blue / emerald / red).

## Type and page chrome

- Page title: `text-2xl font-bold text-[#0A2B4E] tracking-tight`
- Subtitle: `text-sm text-slate-500`
- Content column: `max-w-7xl mx-auto`, vertical rhythm `space-y-5`
- Section cards: `bg-white rounded-xl border border-slate-200/80 shadow-sm`
- Inputs: `px-3 py-2 text-sm border border-slate-200 rounded-lg`, focus `border-[#1D4E89]`
- Labels: `text-xs font-medium text-slate-600`

## Layout shell

- Sticky navy sidebar (collapsible on desktop; drawer on phone).
- Top bar: global search + notification bell + user menu.
- Drivers never see this shell (`/driver-app` only).
- Auth pages use `AuthLayout`, not the office sidebar.

## Shared components (reuse these)

| Component | When |
|-----------|------|
| `ModalShell` | Editează aviz, șablon, forms |
| `ConfirmDialog` | Șterge |
| `StatusBadge` | Trip / invoice status |
| `KpiCard` | Dashboard / Finance |
| `notifySuccess` / `notifyError` | Toasts (auto-dismiss) |
| Legend `<details>` (Avize) | In-page help; open by default, **Ascunde** to collapse |

Primary actions are **buttons with icon + label**, not icon-only, so phone users keep the action.

## Responsive

- **&lt; md:** stacked cards; keep Editează / Confirmă / Șterge visible.
- **md+:** tables with `overflow-x-auto` and `min-w-*` / `table-fixed` + `truncate` + `title` tooltip for long Auto/Rută.
- **Avize list:** cards until `lg`; table columns all have explicit widths (`min-w-[82rem]`) so Rută/Marfă cannot collapse on 13" laptops.
- Toolbar: `flex-wrap items-start`; controls share **height 40px (`h-10`)** so a hint under a select does not lift the dropdown.

## Density

Office tables are operational, not marketing. Prefer one primary row of actions, then a collapsible legend — not a wall of helper paragraphs in the toolbar.

## Accessibility (minimum)

- Modals: `labelledBy` title id, close control with `aria-label="Închide"`.
- File inputs stay visually hidden but triggered by labeled buttons.
- Select for templates has `aria-label="Șablon Anexa Factură"`.

## Copy

- Romanian UI labels (Încarcă, Editează, Unește, Șablon).
- Toasts state the outcome, not the HTTP code.
- Stubs must say so (e-Factura simulare, OCR stub, GPS demo).
