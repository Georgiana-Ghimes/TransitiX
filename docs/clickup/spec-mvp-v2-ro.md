# Spec MVP - Transitix V2

**Versiune aplicație:** 1.3.0  
**Data:** 19 august 2026  
**Statut:** specificație *as-built* (ce există în aplicație azi), nu o rescriere a paginii ClickUp din 2024

Pagina **Spec MVP - Transitix** (2024) rămâne arhivă de viziune. Această V2 descrie produsul real, ce e demo și ce urmează. Detaliul modulului nou e în **Avize - Stare curentă și plan de dezvoltare**.

---

## 1. Ce este Transitix

Transitix este un TMS multi-tenant pentru transport rutier din România.

Biroul gestionează curse (CMR), flotă, șoferi, clienți, depozit, documente și facturi. Șoferul are o aplicație separată. Clientul confirmă livrarea pe un link cu token, fără cont.

**Primul flux de facturare de întărit:** RAI Spedition — avize Baumit (PDF / foto) → tabel de verificare → un XLSX **Anexa Factură RAI**. Asta este pagina **Avize / Rapoarte**. Este o **bază solidă**, nu produsul final de rapoarte.

---

## 2. Utilizatori și acces

| Rol | Unde lucrează | Note |
| --- | --- | --- |
| Admin / dispecer / finance | Aplicația de birou (sidebar) | Navigare completă. Profilul firmei îl salvează doar adminul. |
| Șofer | `/driver-app` | Fără meniul de birou. Curse alocate, poză CMR, status. |
| Client (fără login) | `/confirm/:token` | Confirmare livrare. |

Izolare: toate interogările pe firmă folosesc `company_id`. Nu se amestecă date între companii.

---

## 3. Tehnologie (pe scurt)

- Frontend: React + Vite + Tailwind (`src/`), autentificare JWT
- API: Express (`server/`) + PostgreSQL
- Local: API `:3001`, interfață `:5173` (proxy `/api` și `/uploads`), Postgres Docker pe portul **5434**
- SDK-ul Base44 a fost scos. Nu se reintroduce.

---

## 4. Ce e gata, ce e demo, ce nu e în V2

### Gata de folosit în birou (cu limite cunoscute)

- Autentificare: login, înregistrare, reset parolă, refresh token, limită de încercări la login
- Dashboard, Curse + detaliu cursă, Flotă, Șoferi, Clienți, Depozit, Documente, Setări
- App Șofer și portalul de confirmare livrare
- Facturi în Financiar (status, export CSV, email dacă e configurat Resend)
- Setări firmă (nume, CUI, praguri alerte documente)
- Căutare globală (server)
- **Avize / Rapoarte 1.3.0** — vezi documentul dedicat

### Demo / stub (nu se vând ca integrări live)

| Zonă | Ce face UI-ul azi |
| --- | --- |
| Tracking GPS | Hartă Leaflet + poziții simulate, nu un furnizor GPS |
| Planning AI | Sugestii stub, nu un optimizer real |
| ANAF e-Factura | Butonul marchează local „trimis”, fără SPV |
| Email | Resend dacă există chei; altfel log în consolă / link local la reset |
| OCR CMR | Google Vision dacă e cheia; altfel precompletare din cursă |
| OCR aviz (poză) | Aceeași cheie Vision; PDF-urile **cu strat de text** se citesc fără Vision |

### În afara acestei V2 (pe hârtie, nu în sprintul Avize)

- Telemetrie GPS reală
- XML e-Factura / SPV ANAF
- Planificare curse cu LLM
- Trimitere email a Anexei din Avize (nelegat încă)
- Coduri Observații generate automat
- Legătura aviz ↔ cursă / factură
- Rapoarte generice în afara Anexei XLSX

---

## 5. Harta paginilor de birou

| Meniu | Cale | Rol | Maturitate |
| --- | --- | --- | --- |
| Dashboard | `/` | KPI, curse recente, expirări, grafic status | Live |
| Curse | `/trips`, `/trips/:id` | Planificare / alocare CMR, OCR, link confirmare | Live |
| Flotă / Șoferi / Clienți | `/vehicles` `/drivers` `/clients` | Carduri, dezactivare / reactivare | Live |
| Tracking GPS | `/gps` | Hartă demo | Demo |
| Planning AI | `/planning` | Sugestii demo | Demo |
| Financiar | `/finance` | Facturi; e-Factura e simulare | Live + demo |
| Depozit | `/warehouse` | Stoc produse | Live |
| Documente | `/documents` | ITP, RCA, permis… orizont din Setări | Live |
| Avize / Rapoarte | `/avize` | Extragere avize + Anexa XLSX | Bază 1.3.0 |
| Setări | `/settings` | Profil firmă + zile alertă | Live |
| App Șofer | `/driver-app` | Curse alocate (doar șofer) | Live |
| Portal client | `/confirm/:token` | Confirmare livrare | Live |

**Responsive:** de la ~360px. Sub `md` — carduri; de la `md` — tabele cu scroll orizontal. Acțiunile importante rămân vizibile pe telefon.

---

## 6. UI (as-built) — să nu apară un al doilea look

Limbaj vizual comun pentru tot biroul, inclusiv Avize.

**Culori**

- Navy `#0A2B4E` — sidebar, titluri, buton principal
- Albastru `#1D4E89` — linkuri / hover / focus
- Verde `#0A7A3E` — acțiuni constructive (Unește, Confirmă)
- Fundal `#F8F9FA`, carduri albe, pericol roșu la Șterge

**Chrome**

- Titlu pagină mare, navy; subtitlu o propoziție gri
- Carduri albe, colțuri rotunjite, umbră mică
- Sidebar navy (retractabil pe desktop, sertar pe telefon)
- Șoferii nu văd sidebar-ul de birou
- Login-ul folosește layout separat, nu meniul de birou

**Componente de reutilizat:** modal (Editează / formulare), dialog de confirmare la Șterge, badge-uri de status, toast-uri, legendă pliabilă pe Avize.

**Acțiuni:** buton cu icon + text, nu doar icon, ca să rămână lizibile pe telefon.

**Copie:** etichete în română. Stub-urile trebuie spuse pe nume (simulare e-Factura, OCR stub, GPS demo). Toast-ul spune rezultatul, nu codul HTTP.

**Checklist pentru o pagină nouă**

1. Titlu + un rând de scop
2. Acțiuni primare pe un rând care se înfășoară, aceeași înălțime
3. Stare goală: icon + o frază + ce să faci
4. Carduri pe telefon, tabel de la tabletă în sus
5. Salvare cu toast; nicio salvare tăcută

---

## 7. Avize / Rapoarte — „done” pentru 1.3.0

Destul de gata **pentru test cu avize reale RAI**, nu ca suită de rapoarte. Detalii și planul următor: documentul Avize.

Dispecerul poate:

1. Încărca unul sau mai multe PDF-uri Baumit (strat de text) și primi TPO, dată, numere auto, rută, cantitate, număr document.
2. Edita toate cele 13 câmpuri din anexă. Data, auto, ruta și documentul **rămân** după refresh. **Re-extrage** e singura acțiune care citește din nou fișierul.
3. Confirma, șterge, re-extrage.
4. Administra șabloane XLSX (implicit **Anexa Factura RAI**, 14 coloane).
5. Bifa rânduri, alege șablonul din lista de pe tab-ul Avize, **Unește în Anexa XLSX**.
6. Valorile Default din șablon (ex. Taxă 100, Tarif km 20) se scriu în Excel când pe aviz câmpul e gol sau 0.

Reguli de parser deja testate: TPO doar `TPO-…`; ruta Client → Adresă de livrare (nu Site Expeditor, cu excepția TRO); auto = tractor / trailer, niciodată tot textul PDF.

---

## 8. Criterii de succes

**MVP platformă:** un admin de seed poate parcurge firma de test cap-coadă, fără Base44, cu demo-urile etichetate.

**Felie RAI:** un dispecer transformă o săptămână de avize Baumit într-o Anexă XLSX suficient de apropiată de foaia clientului, după o revizuire umană la km / taxe / tarif / observații.

Următorul pas de produs e documentul Avize. **Nu** se lărgește GPS / e-Factura / Planning în același increment, decât dacă clientul blochează pe ele.

---

## 9. Constrângeri pentru tot ce urmează

- `company_id` pe tabelele și interogările pe firmă
- CHANGELOG + `docs/changes/` + versiuni aliniate (`AGENTS.md`)
- Nu se commit-uiesc PDF-uri / anexe ale clientului (date personale)
- API-ul de entități din `src/api/client.js` înainte de clienți noi
- Semver: patch = fix / docs; minor = funcții vizibile; major = API / schemă care sparge compatibilitatea
