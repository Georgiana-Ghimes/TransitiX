# UX — Toast instead of alert() for form/API errors

## Change

- Added [`src/lib/notify.js`](../../src/lib/notify.js) (`notifyError` / `notifySuccess` + friendly PG messages)
- Replaced `alert()` in:
  - VehicleForm, DriverForm, ClientForm, TripForm, InvoiceForm, WarehouseProductForm
  - Finance, TripDetail, DriverApp, PlanningAI, ClientPortal

## Note

`window.confirm` may still exist on some list delete/deactivate actions (Trips, Drivers, Clients, Warehouse) — separate from form submit alerts.

## Verify

1. Flotă → Vehicul nou → trigger a save error (e.g. huge consum) → toast, not browser alert
2. Same for Șofer / Client / Cursă / Factură forms
