# P5 — Tachograph .ddd archive (partial TLV)

## What

- `server/src/lib/compliance/tachograph.js` — VU/card TLV scan, kind, plates guess, sha256
- Table `tachograph_imports`
- `POST /api/tachograph/import`, `GET /api/tachograph/imports`
- Documents page: upload + import list
- Health `capabilities.tachograph = 'archive'`

## Honesty

- No Reg. 561 driving-time analysis yet
- `partial` = type/tags detected; `stored` = archived without classification; `failed` = too small / unusable

## Later

- Full activity decode + weekly rest / driving limits
- Signature verification against member-state certificates
