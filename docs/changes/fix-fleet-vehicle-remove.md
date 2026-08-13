# Fix — Remove vehicles from fleet

## Problem

Flotă only soft-deactivated vehicles (`is_active: false`). Inactive cards stayed in the list with another "Dezactivează" action and no way to delete them.

## Change

In `src/pages/Vehicles.jsx`:

- Active: **Dezactivează** (soft) + Editează
- Inactive: **Reactivează** + **Șterge** (hard delete via existing `DELETE /api/entities/Vehicle/:id`)

Trip/GPS FKs use `ON DELETE SET NULL`, so hard delete is safe.

## Verify

1. Open Flotă
2. On an inactive vehicle, click **Șterge** and confirm — card disappears
3. On an active vehicle, **Dezactivează** still works; then **Reactivează** restores it
