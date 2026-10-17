# #83 — Șabloane implicite: redenumire OK, ștergere blocată

## Cerință

Șabloanele „implicit” (și Anexa) nu se șterg, dar trebuie să poată fi redenumite.

## Remediere

- UI: **Editează** pe toate; **Șterge** doar pe cele care nu sunt implicit / Anexa
- Anexa: coloane read-only; nume + bifa implicit salvabile
- Server: `preset_id = rai_anexa` pe Anexă (supraviețuiește redenumirii); PUT păstrează coloanele blocate; DELETE refuză `is_default` și Anexa
