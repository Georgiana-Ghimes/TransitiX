# #86 Eliminare „Șabloane gata făcute” din Rapoarte

## Problemă

Pe `/reports` apărea o bandă de butoane care crea șabloane din preseturi. Confuză față de gestionarea șabloanelor din Avize; nu mai era nevoie acolo.

## Remediere

- Scos UI + stare + apeluri din `Reports.jsx`
- Scos `api.reports.presets` / `createFromPreset` din client (endpoint-urile server rămân pentru seed/API)
