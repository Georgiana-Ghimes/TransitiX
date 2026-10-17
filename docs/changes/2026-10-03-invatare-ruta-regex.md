# Învățare rută din Editează (regex pe companie)

La Salvează, dacă `ruta_transport` s-a schimbat, se upsertă o regulă în `aviz_route_rules` din tokenii OCR (Site/Depozit + stradă + nr + localitate).

La extract / list / export, dacă textul OCR potrivește tokenii, se aplică valoarea învățată (`route_source: learned`). Nu calcă `corrected_fields` pe documentul curent.

Hint UI: „Completat din regulă învățată” în Editează.
