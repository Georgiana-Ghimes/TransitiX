# P4 start: 3D loading packer

## Schema

- `warehouse_products`: `length_m`, `width_m`, `height_m`, `unit_weight_kg`, `stackable`,
  `adr_class`, `pallet_type`, `picking_zone`
- `vehicles`: `cargo_*_m`, `axle_front/rear_m`, `axle_*_max_kg`
- `orders.product_id` (optional link)
- `territories` + `locations.territory_id` (stub for the territories track)

## Packer

`server/src/lib/loading/packer.js` — extreme-point 3D bin pack.

- Strategy `lifo`: higher `stop_seq` packed first → toward the nose
- Strategy `warehouse`: group by picking zone / SKU, then LIFO within group
- Default item = EUR pallet 1.2×0.8×1.5 when product dims missing
- Default bay = 13.6×2.45×2.7 when vehicle cargo dims missing
- Axle loads via two-point lever along length; warnings when over max

## API

`POST /api/loading/routes/:routeId/pack` `{ strategy?: 'lifo'|'warehouse' }`

## UI

Dispatch route action → modal with side-view SVG, fill %, axle loads, LIFO/warehouse toggle.
Vehicle form + warehouse product form expose the new fields.
