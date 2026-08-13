# UX — ConfirmDialog instead of window.confirm/alert (Flotă)

## Change

- Added reusable [`src/components/ConfirmDialog.jsx`](../../src/components/ConfirmDialog.jsx) (ModalShell-based)
- [`src/pages/Vehicles.jsx`](../../src/pages/Vehicles.jsx): deactivate/delete use ConfirmDialog; errors/success use toast

## Verify

1. Flotă → Dezactivează or Șterge
2. See in-app modal (not browser alert)
3. Confirm → toast + list updates
