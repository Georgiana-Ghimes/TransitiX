#48 Unește Anexa: block Verificare obligatorie

Product choice: **hard block** (not warn/confirm, not soft filter). Anexa is a
customer invoice sheet; the same HITL gate as Confirmă applies.

- Client: before Unește / Email / Zip, refuse selection with
  `needs_review` or `validation_routing === 'hitl_required'` (unless Confirmat).
- Server: `buildAnnexBuffer` throws 409 `NEEDS_REVIEW` so cross-page selection
  and API clients cannot bypass the UI.
