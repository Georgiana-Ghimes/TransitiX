# Ștergere avize în bulk

## Ce

Pe ecranul Avize, selecția multiplă (aceeași ca la Anexa XLSX / Confirmă / Zip) are acum
**Șterge selectate**, cu dialog de confirmare.

## API

`POST /api/avize/bulk-delete` cu `{ ids: string[] }` (capat ca celelalte bulk).
Răspuns: `{ deleted, ids }`. Doar `company_id` al utilizatorului. Scrie `document_events`
`kind=deleted` cu `document_id` null și `detail.aviz_id`, ca jurnalul să rămână după CASCADE.

## UI

Buton roșu pe toolbar; după succes: toast, selecție goală, reload listă.
Legendă + capitol manual 11 actualizate.
