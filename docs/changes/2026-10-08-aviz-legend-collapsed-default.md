# #67: Legendă acțiuni collapsed la primul access

Fără cheie `transitix_collapsed_avize-actiuni`, panoul pornea expandat (`readCollapsed(id, false)`).

- `AvizLegend`: fallback collapsed (`readCollapsed(id, true)`).
- Preferința salvată Ascunde/Arată neschimbată.
