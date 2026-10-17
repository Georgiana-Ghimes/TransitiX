#54 Nr. document marfă = „220” din adresă

Generic aviz profile matched `nr. 220` (house number on Bvd. Iuliu Maniu) before
TRO-0010203 on rezumat sheets.

Fix: `canonicalDocNo` rejects bare short digit runs; `aviz_generic` prefers
TRO/PSL patterns; labelled fallback requires PSL|TRO|TEST-AVZ. Residual bad
values get `doc_no_invalid` (HITL optional).
