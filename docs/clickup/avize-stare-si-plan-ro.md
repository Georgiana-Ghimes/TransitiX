# Avize - Stare curentă și plan de dezvoltare

**Pagină în app:** `/avize` (Avize / Rapoarte)  
**Versiune bază:** 1.3.0 (checklist manual trecut pe PDF cu strat de text)  
**Data:** 19 august 2026

Numele paginii din meniu e **Avize / Rapoarte**. Ce s-a livrat e **aviz → Anexa XLSX**. Tab-ul de rapoarte generice vine mai târziu.

Nu se amestecă în aceste incrementuri: GPS live, Planning AI, e-Factura ANAF.

---

## 1. Stare curentă (baza 1.3.0)

Dispecerul încarcă avize Baumit (PDF sau poză), corectează tabelul Anexei și unește rândurile într-un XLSX pe șablonul clientului.

Omul rămâne pe circuit pentru **km, taxe, tarif, valoare TPO, observații**.

### Ce merge azi

- Încărcare PDF / Foto (mai multe fișiere)
- Extragere: TPO, dată, auto, rută, tip / cantitate, număr document
- Editează — 13 câmpuri; **data, auto, ruta, documentul persistă** după Salvează și refresh
- Confirmă / Re-extrage / Șterge
- Tab **Șabloane**: Anexa Factura RAI (14 coloane, antet galben) + șabloane proprii (Taxă 100, Tarif km 20 etc.)
- **Unește în Anexa XLSX** — folosește șablonul din lista de pe tab-ul Avize, nu „ultimul salvat în Șabloane”

### Flux pe ecran

**Tab Avize:** Încarcă · Foto · lista de șabloane · Unește. Sub listă, o linie scurtă de ajutor. Legenda de acțiuni e pliabilă.

**Listă:** pe telefon — carduri; pe desktop — tabel (TPO, Data, Auto, Rută, Marfă, Document, Status, Acțiuni). Textul lung se taie; valoarea întreagă e pe hover.

**Status:** Încărcat → Extras → Confirmat. Unește merge și pe rânduri neconfirmate; Confirmă înseamnă „gata de factură”.

| Acțiune | Comportament |
| --- | --- |
| Editează | Salvează în baza de date. **Nu** recitește PDF-ul. |
| Confirmă | Status Confirmat; butonul dispare |
| Re-extrage | Recitește fișierul și **rescrie** TPO / dată / auto / rută / cantitate / document. Km și taxele se reintroduc. |
| Șterge | Dialog de confirmare; fără undo |

**Tab Șabloane:** carduri cu număr de coloane, implicit, Editează / Șterge. După salvare, șablonul trebuie selectat pe Avize, apoi Unește din nou ca să vezi Taxă / Tarif în Excel.

### Reguli de extragere (contract cu testerii)

- **Număr TPO:** doar `TPO-` + cifre (nu MPI / Adeziv). TPO scris manual se păstrează dacă PDF-ul n-are TPO.
- **Rută:** adresă **Client** (start) → **Adresă de livrare** (sfârșit). Nu Site Expeditor Bolintin. Site MIL/BOL doar la TRO, dacă lipsește strada Client.
- **Număr auto:** tractor și trailer (`B-112-VFM / B-475-AGR`). Niciodată tot documentul în câmp.
- Abrevieri de stradă recunoscute azi: strada, str., șosea, bulevardul, bd., calea. **`Blvd` încă nu.** Formatul scurt de birou (`Bol-Domnesti/…`) nu se generează automat; dacă îl scrii în Editează, trebuie să rămână.

### Ce lipsește încă (nu sunt bug-uri 1.3.0)

- Filtru dată / client / TPO; lista e plafonată la 200 de rânduri
- Avertisment la TPO duplicat
- Previzualizare PDF lângă Editează
- Foto + Vision: neconfirmat în checklist (U5 N/A)
- Observații = text liber, fără coduri RAI
- Nu există tab Rapoarte (doar export Anexă)
- Avizele nu apar pe Dashboard sau pe detaliu cursă

---

## 2. Obiectiv „gata pentru RAI”

Un dispecer poate:

1. Arunca o săptămână de avize (PDF și poză de telefon)
2. Vede câmpurile nesigure evidențiate
3. Corectează o coadă scurtă, nu toată anexa de la zero
4. Aplică coduri observații RAI și Default-urile din șablon
5. Exportă Anexa XLSX și, opțional, o trimite pe email sau o leagă de o factură ciornă
6. Găsește un TPO fără să deruleze 200 de rânduri nefiltrate

Până atunci, pagina rămâne **Avize / Rapoarte**, dar „Rapoarte” e un tab ulterior.

Efort: S / M / L pentru un om care cunoaște repo-ul.

---

## 3. Increment A — 1.3.x polish (următorul pas)

**Scop:** mai puține Editează pe avizele reale; lista rămâne folosibilă când cresc volumele.  
**Mărime:** M  
**Depinde de:** PDF-uri reale RAI (nu se pun în git).

**Povești**

- Abrevieri: `Blvd`, `Bld`, `Aleea`, `Al.`, `Pța` / `Piata`, dacă apar pe avize
- Afișare opțională rută „de birou” (`Bol-Domnesti/…`) ca toggle sau câmp doi — **fără** a strica parsarea Client → Livrare (testerii aleg formatul)
- Filtre: dată de / până la, status, căutare text (TPO, auto, document, nume fișier)
- Avertisment dacă `numar_tpo` există deja la firmă
- Pe rând: sursa extragerii (`pdf-text` / `vision` / `stub`) ca Încărcat să fie explicabil
- Previzualizare fișier la Editează (tab nou e suficient pentru un S)

**Acceptanță**

- Avizele care picau doar pe `Blvd` se citesc fără rescrierea parserului
- Filtru și căutare merg pe telefon
- TPO duplicat: avertizează, dar lasă salvarea (de confirmat cu RAI dacă transferurile se repetă)
- Fără regresii: Editează persistă; Re-extrage rescrie din fișier

**În afara scopului:** tipuri noi de XLSX; cheia Vision ca cerință de go-live.

---

## 4. Increment B — 1.4 flux de birou

**Scop:** anexa e un ritual săptămânal, nu un export ocazional.  
**Mărime:** L

**Povești**

- Presetări dată: azi / săptămâna asta / luna asta (fus București)
- Confirmă în masă pe rândurile bifate
- Ajutor Observații: coduri salvate pe firmă (ex. `Z:B*`) ca chip-uri, tot editabile
- Email anexă: atașament Resend dacă există chei; altfel doar download + toast (ca la facturi)
- Zip cu PDF-urile originale lângă XLSX (fișierele rămân pe serverul lor)
- Split un PDF pe două rânduri — doar dacă RAI cere explicit

**Acceptanță**

- 20 de rânduri confirmate fără deschis fiecare modal
- Codurile apar în coloana Observatii din Excel
- Calea de email e documentată (configurat vs stub)

---

## 5. Increment C — 1.5 calitate OCR (poze și alte layout-uri)

**Scop:** Foto și PDF scanat sunt de primă clasă când Vision e configurat.  
**Mărime:** L  
**Risc:** cost și acuratețe. Stratul de text rămâne calea implicită.

**Povești**

- Runbook `GOOGLE_VISION_API_KEY` în VM Steps (fără secrete în git)
- Rasterizare PDF-uri sărace în text, înainte de Vision
- Încredere pe câmp: evidențiere Auto / Rută / TPO când lipsește sau e gunoi
- Al doilea pachet de layout-uri doar după 10+ mostre non-Baumit. Fără ghicit.

**Acceptanță**

- U5 (Foto) e Pass sau limitare scrisă
- Rând stub doar dacă au eșuat și textul, și Vision
- Testele unitare rămân pe fixture sintetice; PDF-urile clientului stau local

---

## 6. Increment D — 1.6 legătură Curse și Financiar

**Scop:** anexa nu e o insulă.  
**Mărime:** L  
**Nu începe** până A–B stau bine într-o săptămână RAI.

**Povești**

- `trip_id` opțional / sugestie după număr auto și zi
- „Ciornă factură din avizele confirmate” — sumă valoare TPO **sau** km × tarif (**RAI alege regula**)
- Fără trimitere tăcută către ANAF

**Acceptanță**

- Legătura e opțională; exportul merge și fără ea
- Ciorna se revizuiește în Financiar
- e-Factura rămâne simularea actuală până la un proiect separat

---

## 7. Increment E — 1.7 Rapoarte

**Scop:** mai mult decât un tip de anexă.  
**Mărime:** L  
**Doar după D**, sau dacă RAI cere întâi km / lună.

**Candidați (se aleg cu clientul, nu se construiesc toți)**

- Km / tarif lunar pe număr auto
- Număr avize pe client / săptămână
- Istoric export (cine a unit ce)
- A doua familie de șabloane, nu Anexa, cu Default-uri proprii

**Acceptanță**

- Tab **Rapoarte** sau un selector de tip care **nu** poate suprascrie din greșeală Anexa Factura RAI
- Șabloanele rămân pe `company_id`

---

## 8. Ordinea de lucru

```
1.3.0 bază (gata)
    → A polish (parser + filtre)     următorul
    → B flux săptămânal (bulk, coduri, email)
    → C Vision / scanări
    → D curse / facturi
    → E rapoarte extra
```

Doi oameni în paralel: A se poate suprapune cu C (parser vs Vision) doar dacă nu se calcă în `avizOcr.js` fără o separare clară (text vs apel Vision).

**Mai târziu, în afara Avize:** GPS live, Planning LLM real, XML e-Factura, mișcări depozit din liniile de aviz.

---

## 9. Decizii deschise (de bifat cu RAI)

| Întrebare | Implicit până răspunde RAI |
| --- | --- |
| TPO duplicat permis? | Avertizează, lasă salvarea |
| Format rută în Excel | Păstrăm Client → Livrare; alias scurt mai târziu |
| Sumă factură | Valoare TPO / km×tarif editate de om, nu totaluri oarbe din PDF |
| OCR poză obligatoriu la go-live? | Nu. Calea 1.3.0 e PDF cu text |

---

## 10. Note pentru următorul increment (tehnic)

- Câmpurile editate în birou au prioritate. **Nu** se repornește repair la fiecare încărcare a listei.
- `pdf-parse` XRef: se păstrează retry-urile.
- Nu se commit-uiesc `server/uploads/*` ale clientului.
- Teste: `avizOcr.test.js`, `avizExport.test.js`.
- La fiecare increment: CHANGELOG + `docs/changes/`.
