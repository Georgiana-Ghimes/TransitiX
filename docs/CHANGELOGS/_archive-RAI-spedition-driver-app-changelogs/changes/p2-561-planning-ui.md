# P2: Reg. 561/2006 + Planning UI

## Driving rules (`server/src/lib/planning/drivingRules.js`)

Post-processor run after `parseSolution` inside `runSolve`:

- 4 h 30 continuous driving → insert `pauza` (45 min)
- 9 h daily driving → insert `repaus` (11 h)
- Legs longer than the remaining allowance are split: drive to the limit, insert the
  stop, finish the leg (distance proportional)
- Clocks rebuilt; order windows re-checked → `window_violations` on kpis
- `driving_rule_violations` is always 0 on the output — by construction the rebuilt
  route never exceeds the continuous / daily caps

Not modelled yet: split break 15+30, twice-weekly 10 h extension.

## UI

`PlanningAI.jsx` replaces the LLM stub: date, health pills, solve, scenario list,
KPI comparison table, promote / delete, route stop preview including breaks.

Nav item no longer marked `demo`.

## Forms

Vehicle: capacity_pallets, capabilities (comma-separated → TEXT[]), cost_per_km,
cost_per_hour. Driver: shift_start, shift_end.
