# Changelog

## [1.13.1] - 2026-09-30

### Fixed

- Companion: lista „Trimise recent” **nu mai repornește OCR** la fiecare poll/reload pe rândurile „Se procesează…” (asta umplea coada Paddle și omora sidecar-ul/VM)
- OCR eșuat rămâne eșuat: un răspuns Paddle întârziat nu mai rescrie câmpurile după fail-stale (explica „se completează singur fără Re-extrage”)
- Dacă Paddle e down: upload-urile noi și spinner-ele blocate ale șoferului trec imediat la **Eșuat OCR**, fără a aștepta 90s
- Toast „Completează câmpurile lipsă” doar când OCR tocmai a terminat, nu la fiecare reload al paginii

## [1.13.0] - 2026-09-30

### Added

- Admin Editează aviz: câmp **Greutate netă (kg)** lângă brută
- Bifă **Include în XLSX** sub greutatea brută și netă — coloanele din anexă urmează bifele (brută → Cantitate marfa tone; netă → Greutate netă kg; una, ambele sau niciuna)
- Companion: tokeni UX mari (`driverUi`) pentru citire ușoară pe telefon (shell, upload, review, profil)

### Fixed

- OCR PDF Baumit: greutatea brută din layout-ul pe coloane (`378 sac` + `9.487,80 kg` înaintea etichetei goale „Greutate brută: pce”)
- OCR: unitate în paranteze `Greutate brută (kg) 9.487,80`
- Filtru **Azi** pe avize: ziua București, nu `date AT TIME ZONE` pe coloana DATE
- Preview aviz: mesaj centrat pentru `manual://`; fără link „Deschide documentul” pe manual
- Manual driver → status **needs_review**, nu confirmat din start

### Changed

- Upload companion: acțiuni principale Poză + Manual; galerie ca link subtil
- Label „parser nesigur” scurtat la „verifică” în Editează

## [1.12.0] - previous

See git history for earlier releases.
