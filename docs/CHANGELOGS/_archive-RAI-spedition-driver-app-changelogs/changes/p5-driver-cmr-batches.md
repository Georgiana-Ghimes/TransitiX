# Driver digital CMR + Faza 3 batches

## What

- `api.cmr` / `api.driverDocuments` in `src/api/client.js`
- `DriverCmrPanel` on trip detail in the driver app: digital form (prefill, draft, sign loading/delivery) + photo upload into `document_batches`
- Replaces the old `TripDocument` + on-device LLM OCR upload path
- API refuses digital save/sign when a scan already exists on the trip

## Why

Closes the remaining Faza 5 gap: written CMR in the cab, and road photos in the same office review queue as Documente uploads.

Office trip detail reuses the same form (`showBatchUpload: false`); paper scan remains optional and flips `source` to `scan`.

Follow-up: driver uploads kick off `extractBatchDocuments` in the background; loading-stage sign copies weight/packages/goods onto the trip; Avize list filters and badges `uploaded_from=driver`.
