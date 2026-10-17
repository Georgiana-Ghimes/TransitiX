#52 Nr. auto: TM-40-KG din „Tencuiala TM 40 kg”

TM is a real RO county. Product line `TM 40 kg` matched the plate regex as
`TM-40-KG`. With identical tractor/trailer plates (deduped to one), that false
token became the second plate and poisoned zone-tax MTMA lookup.

Fix: blocklist letter-series that are packaging/weight units (`KG`, `SAC`, …)
in `isPlausiblePlateSeries`, used by `canonicalPlate` and `extractPlates`.
