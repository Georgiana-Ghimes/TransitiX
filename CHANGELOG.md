# Changelog

## [1.13.4] - 2026-09-30

### Fixed

- Avizele rămâneau pe **„Se procesează…”** după 1.13.2: rândurile aflate în coada OCR erau excluse din fail-stale (90s), deci un job blocat pe Paddle nu trecea niciodată la Eșuat. Răspunsul OCR întârziat tot nu rescrie un rând deja eșuat (`status='uploaded'` la UPDATE)
- Dacă extragerea de batch crapă înainte de bucla pe documente, toate rândurile din batch trec acum la Eșuat (înainte rămâneau spinner)

## [1.13.3] - 2026-09-30

### Fixed

- **Primul PDF citit după restart eșua** cu „bad XRef entry”: `pdf-parse` era încărcat de două ori (prin `import` și prin `createRequire` în `avizOcr.js`), iar cele două copii de pdf.js se călcau pe aceeași variabilă globală. Un PDF cu strat de text perfect cădea pe OCR de 5 minute degeaba
- OCR pe poze: eticheta și valoarea de lângă ea ajungeau pe linii diferite, fiindcă Paddle întoarce câte o casetă separată pentru fiecare. Rândurile sunt acum reconstruite din coordonate, deci greutatea brută etichetată se **citește** (0.95), nu se mai ghicește din numărul de saci de lângă (0.8)
- Număr auto din PDF: `Nr. autoB 330 SRS` (celule lipite de pdf-parse) nu avea graniță de cuvânt înaintea județului, deci plăcuța nu era găsită pe un PDF care o tipărește clar

### Added

- Cache de text OCR per firmă, cheie = sha256 al fișierului: aceeași poză sau PDF nu se mai citește de două ori. „Re-extrage” refolosește doar o citire bună (cu cod TPO/PSL/TRO); una slabă se reia la sidecar
- Curățare cache în pasul de retenție (TTL + versiunile vechi de pipeline)

### Changed

- Strat de text PDF citit cu poziții (`pdfRows.js`): un rând tipărit = o linie, tab între coloane, spațiu între cuvinte. Capturile de text (rută, tip marfă, expeditor, destinatar) se opresc la tab, deci nu mai trec în coloana vecină
- Paddle pe CPU: `PADDLE_OCR_MKLDNN=1` (~2x) și 4 thread-uri în loc de 10, care sufocau un VM mic
- Limite de CPU/memorie în docker-compose pentru ambele sidecar-uri, plus healthcheck la clasic: dacă OCR-ul crește necontrolat, moare containerul și repornește, nu VM-ul

## [1.13.2] - 2026-09-30

### Fixed

- Sidecar Paddle: OCR-ul rulează în afara event loop-ului — `/health` răspunde și când procesează, deci „ocupat” nu mai e citit ca **paddle-down** (care marca toate upload-urile ca Eșuat)
- Rândurile aflate efectiv în coada OCR nu mai sunt picate de fail-stale după 90s; înainte OCR-ul rula oricum pe ele și rezultatul era aruncat
- Înainte de OCR, fiecare rând e reverificat — unul picat / completat manual / șters între timp nu mai consumă CPU
- Poze cu orientare EXIF (telefon) sunt întoarse înainte de OCR, nu după 3 treceri de rotație în plus

### Changed

- Un singur job OCR odată (Node `OCR_CONCURRENCY=1` + lock în ambele sidecar-uri); coada intră în bugetul de timp
- Un singur buget pentru clasic + VL (înainte VL primea încă un timeout întreg după clasic)
- Node trimite `budget_ms`: sidecar-ul se oprește când apelantul a renunțat (504) sau nu mai pornește dacă bugetul s-a dus în coadă (503)
- VL doar pentru PDF-uri ≤ 2 pagini, cu ≥ 90s buget rămas; după 2 citiri goale / expirate VL se oprește 30 min
- VL scos din `.env.example` implicit: pe CPU 266s pentru o poză (0 caractere) și timeout la 300s pe alte 4, față de 1–7s la clasic
- Pagini 2+ dintr-un scan: dacă se citesc sigur în orientarea paginii 1, fără încă 3 rotații; poze curate (CMR etc.) sar peste cele 5 treceri agresive
- Sidecar Paddle încarcă modelele la pornire (`PADDLE_OCR_WARMUP`), `/health` arată `busy` / `waiting`

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
