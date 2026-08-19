# Planning — Avize / Rapoarte (checklist)

**Pagină:** `/avize` (meniu: Avize / Rapoarte)  
**Bază livrată:** 1.3.0 anexă XLSX; app curent **1.3.2**  
**Data plan:** 19 august 2026  
**Tab Rapoarte generice:** nu în A–D; abia increment E  

**În afara acestor incrementuri (nu se amestecă):** GPS live · Planning AI · e-Factura ANAF · mișcări depozit din linii aviz  

**La fiecare increment închis:** teste · `CHANGELOG.md` · `docs/changes/` · `package.json` + `server/package.json` aliniate  

**Bifează** `[x]` când e gata. Porțile RAI rămân `[ ]` până există răspuns.

---

## 0. Freeze 1.3.0 (deja livrat — referință)

Nu se redeschid ca „bug 1.3.0”:

- [x] Upload PDF, extract TPO / dată / auto / rută / tip+cantitate / nr. document
- [x] Editează 13 câmpuri; persistă după Salvează + refresh (nu recitește PDF)
- [x] Confirmă / Re-extrage / Șterge (dialog, fără undo)
- [x] Șabloane: Anexa Factura RAI + proprii; Unește = șablonul din lista de pe tab Avize
- [x] Status Încărcat → Extras → Confirmat; Unește și pe neconfirmate
- [x] TPO doar `TPO-` + cifre; rută Client → Livrare; auto tractor/trailer
- [x] Abrevieri stradă de bază: strada, str., șosea, bulevardul, bd., calea
- [x] Fără tab Rapoarte; fără avize pe Dashboard / detaliu cursă

**Lipsă conștientă (backlog, nu bug):** filtru · TPO duplicat · preview PDF · Foto/Vision U5 · observații fără coduri RAI · listă plafon 200

---

## G0 — Pregătire înainte de A

- [x] PDF-uri RAI reale pe mașina de dev (nu se pun în git / `server/uploads` client)
- [ ] Cel puțin 2 PDF-uri care pică azi pe `Blvd` / `Bld` (dacă există)
- [x] Confirmare testeri: rută Excel rămâne Client → Livrare până la răspuns RAI
- [x] Lucru direct pe `RAI-spedition` (fără branch feature)

---

## Increment A — polish 1.3.x (următorul pas, mărime M)

**Scop:** mai puține Editează; lista folosibilă la volum.  
**Versiune țintă:** 1.3.3 (dacă A2 e doar display) sau 1.4.0 (dacă A2 e câmp + Excel). Implicit: **1.3.3**.  
**Depinde de:** G0.

### A1 — Parser abrevieri stradă

**Fișiere:** `server/src/lib/avizOcr.js` · `server/src/lib/avizOcr.test.js`

- [ ] Extinde regex stradă: `Blvd`, `Bld`, `Aleea`, `Al.`, `Pța`, `Piata`, `Pta` (fără diacritice)
- [ ] Nu rescrie restul parserului (TPO, auto, Site Expeditor)
- [ ] Teste sintetice: blob cu `Blvd` → rută Client → Livrare
- [ ] Verificare manuală pe PDF-urile din G0
- [ ] Fără regresii: `strada` / `str.` / `bd.` existente încă trec

### A2 — Rută de birou (după alegere testeri)

**Implicit până aleg:** câmp salvat separat; Excel rămâne Client → Livrare.

- [ ] Decizie testeri: toggle afișare **sau** câmp `ruta_display` (recomandat: câmp nullable)
- [ ] Migrație DB dacă e câmp (`aviz_documents.ruta_display`)
- [ ] Editează: persistă alias-ul; Re-extrage **nu** îl șterge
- [ ] UI: arată alias dacă e completat, altfel `ruta_transport`
- [ ] Export XLSX: neschimbat până RAI cere alias în coloana Ruta
- [ ] Test: save + re-extract păstrează `ruta_display`

### A3 — Filtre + căutare

**Fișiere:** `server/src/routes/avize.js` · `src/pages/AvizeReports.jsx` · `src/api/client.js`

- [ ] API list: `from`, `to` (dată cursă), `status`, `q` (TPO, auto, nr. document, nume fișier)
- [ ] Limit 200 **după** filtru; `company_id` obligatoriu
- [ ] UI desktop: bară filtre deasupra tabelului
- [ ] UI telefon (~360px): aceleași filtre + carduri (nu doar tabel)
- [ ] Preseturi dată **nu** aici (sunt B1)
- [ ] Fără filtru client până există `client_id` pe aviz (increment D)

### A4 — Avertisment TPO duplicat

- [ ] La save/upload: același `company_id` + același `numar_tpo` (case-insensitive), exclude rândul curent
- [ ] UI: mesaj vizibil; **salvarea rămâne permisă** (până RAI zice altfel)
- [ ] **Nu** adăuga UNIQUE index
- [ ] Test: al doilea TPO identic → warning, rândul există

### A5 — Sursa extragerii pe rând

- [ ] Coloană `extraction_source`: `pdf-text` | `vision` | `stub`
- [ ] Setată la upload și la Re-extrage
- [ ] Badge pe card + tabel (Încărcat explicabil)
- [ ] Test: extract text → `pdf-text`; stub → `stub`

### A6 — Previzualizare fișier în Editează

- [ ] Panou sau tab: PDF/imagine via URL autentificat (`uploadUrl` + JWT)
- [ ] Merge pe telefon (scroll / overflow, fără UI doar desktop)
- [ ] Nu e editor PDF

### A7 — Închidere A

- [ ] Smoke: Editează persistă după refresh
- [ ] Smoke: Re-extrage rescrie TPO/dată/auto/rută/cantitate/document; km/taxe rămân de reintrodus (comportament 1.3.0)
- [ ] `CHANGELOG` + `docs/changes/1.3.3-…` (sau 1.4.0)
- [ ] Commit + push; merge pe `main` când RAI/testeri e OK

**Gata A când:** A1, A3–A6 + freeze A7; A2 dacă testerii au ales formatul.

---

## Increment B — 1.4 flux săptămânal (mărime L)

**Poartă:** A folosit pe date reale **sau** cel puțin A1+A3+A4+A6 închise.  
**Scop:** anexa = ritual săptămânal, nu export ocazional.

### B0 — Poartă

- [ ] A e pe `main` / VM
- [ ] Split PDF (B6) **necerut** de RAI → sare B6

### B1 — Presetări dată (fus București)

- [ ] Chip-uri: Azi / Săptămâna asta / Luna asta (`Europe/Bucharest`)
- [ ] Reuse query-urile din A3 (`from` / `to`)

### B2 — Confirmă în masă

- [ ] `POST /api/avize/bulk-confirm` `{ ids[] }`, office, `company_id`, tranzacție
- [ ] UI: Confirmă pe rândurile bifate
- [ ] Acceptanță: 20 rânduri fără 20 de modale Editează

### B3 — Coduri Observații RAI

- [ ] Tabel `aviz_observation_codes` (`company_id`, `code`, `label`, sort)
- [ ] CRUD minim în Setări **sau** pe tab Șabloane / Avize (un loc, nu două)
- [ ] Chip-uri în Editează; textul rămâne editabil
- [ ] Excel: coloana Observatii = textul salvat (inclusiv coduri)

### B4 — Email anexă

- [ ] Același pattern ca facturile (Resend dacă e cheie, altfel download + toast)
- [ ] Documentat: configurat vs stub (`docs/changes/`)

### B5 — Zip PDF-uri + XLSX

- [ ] Export zip: Anexa XLSX + originalele de pe disk
- [ ] Fișierele rămân pe server; zip-ul e download

### B6 — Split un PDF → două rânduri

- [ ] Doar dacă RAI bifează explicit mai jos (G-RAI)
- [ ] Altfel: skip, nu se începe

### B7 — Închidere B

- [ ] CHANGELOG 1.4.x + `docs/changes/`
- [ ] Calea de email verificată pe VM (sau stub documentat)

**Gata B când:** B1–B5; B6 doar dacă e cerut.

---

## Increment C — 1.5 calitate OCR (mărime L)

**Risc:** cost Vision + acuratețe. **Default rămâne PDF cu strat de text.**  
**Paralel cu A:** da, **doar** dacă Vision e fișier separat (ex. `avizVision.js`), nu se calcă regex-ul din `avizOcr.js`.

### C0 — Poartă

- [ ] Decizie RAI: OCR poză **nu** e obligatoriu la go-live (implicit Da = nu e blocker A/B)
- [ ] Cheie Vision **nu** se pune în git

### C1 — Runbook

- [ ] Pași `GOOGLE_VISION_API_KEY` în VM Steps (doc intern, fără secret)

### C2 — Rasterizare PDF sărac

- [ ] Dacă pdf-parse dă prea puțin text → raster + Vision
- [ ] Altfel: calea text 1.3.0
- [ ] Retry XRef pdf-parse se păstrează

### C3 — Încredere pe câmp

- [ ] Highlight Auto / Rută / TPO lipsă sau gunoi (reuse logica TPO garbage)
- [ ] UI Editează + listă (câmp nesigur evidențiat)

### C4 — Foto / U5

- [ ] Foto + Vision: Pass **sau** limitare scrisă în doc
- [ ] Stub doar dacă au eșuat **și** textul, **și** Vision
- [ ] `extraction_source = vision` când e cazul (A5)

### C5 — Layout-uri non-Baumit

- [ ] Minimum 10 mostre locale non-Baumit **înainte** de parser nou
- [ ] Fără ghicit layout

### C6 — Închidere C

- [ ] Teste unit pe fixture sintetice; PDF client rămâne local
- [ ] CHANGELOG 1.5.x + `docs/changes/`

---

## Increment D — 1.6 Curse + Financiar (mărime L)

**Poartă:** A–B stabile ~1 săptămână pe flux RAI.

### D0 — Poartă

- [ ] B pe VM / producție internă
- [ ] RAI a ales regula de sumă factură (valoare TPO vs km × tarif)

### D1 — Legătură cursă (opțională)

- [ ] `trip_id` nullable pe `aviz_documents`
- [ ] Sugestie: același număr auto + aceeași zi
- [ ] User poate salva fără `trip_id`
- [ ] Export XLSX merge fără cursă
- [ ] Avizul **nu** e obligatoriu pe Dashboard / TripDetail în acest increment (doar dacă e trivial); altfel ticket separat mic

### D2 — Ciornă factură

- [ ] Acțiune: din avize **confirmate** selectate → ciornă în `/finance`
- [ ] Sumă = regula RAI (omul poate edita înainte de emitere)
- [ ] **Fără** trimitere ANAF / e-Factura

### D3 — Închidere D

- [ ] CHANGELOG 1.6.x + `docs/changes/`

---

## Increment E — 1.7 Rapoarte (mărime L)

**Poartă:** după D **sau** dacă RAI cere întâi km / lună.

### E0 — Alegere cu clientul (nu se construiesc toți)

- [ ] Km / tarif lunar pe număr auto
- [ ] Număr avize pe client / săptămână (necesită client pe aviz)
- [ ] Istoric export (cine a unit ce)
- [ ] A doua familie de șabloane (nu Anexa), Default-uri proprii

### E1 — UI

- [ ] Tab **Rapoarte** (sau selector de tip)
- [ ] Selectorul **nu** poate suprascrie din greșeală Anexa Factura RAI
- [ ] Șabloane tot pe `company_id`

### E2 — Închidere E

- [ ] CHANGELOG 1.7.x + `docs/changes/`
- [ ] Meniul rămâne Avize / Rapoarte (acum tab-ul merită numele)

---

## Decizii RAI (porți)

| # | Întrebare | Implicit până răspund | Bifează când e confirmat |
|---|-----------|----------------------|---------------------------|
| R1 | TPO duplicat permis? | Avertizează, lasă salvarea | [ ] |
| R2 | Format rută în Excel | Client → Livrare; alias scurt mai târziu | [ ] |
| R3 | Sumă factură | Valoare TPO / km×tarif editate de om | [ ] |
| R4 | OCR poză obligatoriu go-live? | Nu; calea 1.3.0 = PDF text | [ ] |
| R5 | Split un PDF pe două rânduri? | Nu, până cer explicit | [ ] |

---

## Ordine de lucru

```
G0
 → A1 → A5 → A3 → A4 → A6 → (A2 după R2/testeri) → A7 freeze
 → B0 → B1 → B2 → B3 → B4 → B5 → (B6 dacă R5) → B7
 → C (paralel cu A doar pe avizVision, nu pe regex rută)
 → D0 → D1 → D2 → D3
 → E0 → E1 → E2
```

**Doi oameni:** Om 1 = A/B API+UI. Om 2 = C Vision. Nu editați același bloc din `avizOcr.js` fără split text vs Vision.

---

## Note tehnice (să nu se uite)

- [ ] Câmpurile de birou au prioritate; nu reporni `repair` la fiecare load listă
- [ ] Păstrează retry-urile pdf-parse XRef
- [ ] Nu commit `server/uploads/*` client
- [ ] Teste de bază: `avizOcr.test.js`, `avizExport.test.js`, concurrency re-extract
- [ ] Unește = `template_id` de pe tab Avize, nu ultimul salvat în Șabloane

---

## Status sprint (actualizează aici)

| Increment | Status | Versiune | Dată |
|-----------|--------|----------|------|
| 1.3.0 bază | Done | 1.3.0–1.3.2 | 2026-08 |
| A polish | Done pe `RAI-spedition` | 1.7.0 | 2026-08-19 |
| B flux birou | Done (B6 skip) | 1.7.0 | 2026-08-19 |
| C Vision | Done (modul separat) | 1.7.0 | 2026-08-19 |
| D curse/facturi | Done (fără ANAF) | 1.7.0 | 2026-08-19 |
| E rapoarte | Done | 1.7.0 | 2026-08-19 |
