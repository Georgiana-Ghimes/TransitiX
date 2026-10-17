# Ghid dispecer (birou)

## Cuprins

1. [Pentru cine e acest ghid](#pentru-cine-e-acest-ghid)
2. [Cum să… (index rapid)](#cum-să--index-rapid)
3. [Cum planific ziua în Dispecerat](#cum-planific-ziua-în-dispecerat)
4. [Cum rulez Planning AI și promovez un scenariu](#cum-rulez-planning-ai-și-promovez-un-scenariu)
5. [Cum creez și urmăresc o cursă](#cum-creez-și-urmăresc-o-cursă)
6. [Cum lucrez cu CMR pe cursă](#cum-lucrez-cu-cmr-pe-cursă)
7. [Cum văd planul de încărcare pe o rută reală](#cum-văd-planul-de-încărcare-pe-o-rută-reală)
8. [Cum aranjez marfa pe Plan 2D (vizualizare și tragere)](#cum-aranjez-marfa-pe-plan-2d-vizualizare-și-tragere)
9. [Cum încarc și confirm avize](#cum-încarc-și-confirm-avize)
10. [Cum verific datele înainte de facturare](#cum-verific-datele-înainte-de-facturare)
11. [Cum urmăresc GPS și excepțiile](#cum-urmăresc-gps-și-excepțiile)
12. [Cum verific locațiile pe hartă](#cum-verific-locațiile-pe-hartă)
13. [Cum generez teritorii](#cum-generez-teritorii)
14. [Cum văd documentele care expiră](#cum-văd-documentele-care-expiră)
15. [Cum lucrez în Financiar (pe scurt)](#cum-lucrez-în-financiar-pe-scurt)

---

## Pentru cine e acest ghid

Pentru rolurile de birou: **dispecer**, **finance** și **admin** (partea operațională).

Nu acoperă invitațiile de utilizatori — vezi [Ghid administrator](admin-guide.md).

**Cum citești pașii:** fă câte un pas, verifică pe ecran că s-a întâmplat ce scrie, apoi treci la următorul. Dacă un buton nu e vizibil, mărește fereastra browserului (unele acțiuni pe telefon apar diferit față de calculator).

## Cum să… (index rapid)

- [Cum planific ziua în Dispecerat?](#cum-planific-ziua-în-dispecerat)
- [Cum optimizez rutele cu Planning AI?](#cum-rulez-planning-ai-și-promovez-un-scenariu)
- [Cum creez o cursă și o aloc?](#cum-creez-și-urmăresc-o-cursă)
- [Cum completez sau verific un CMR?](#cum-lucrez-cu-cmr-pe-cursă)
- [Cum văd cum se umple camionul pe o rută?](#cum-văd-planul-de-încărcare-pe-o-rută-reală)
- [Cum trag paleții pe desenul camionului?](#cum-aranjez-marfa-pe-plan-2d-vizualizare-și-tragere)
- [Cum procesez avizele pe lot?](#cum-încarc-și-confirm-avize)
- [Cum aflu dacă TPO-ul e greșit?](#cum-verific-datele-înainte-de-facturare)
- [Cum văd unde e camionul?](#cum-urmăresc-gps-și-excepțiile)

---

## Cum planific ziua în Dispecerat

**De ce:** pe teren lucrezi pe **zi și rute**, nu pe o listă lungă de curse fără context.

1. În meniul din stânga, apasă **Dispecerat**.
2. Sus pe ecran, alege **data** zilei de lucru (calendarul / selectorul de dată).
3. În stânga (sau pe panoul de comenzi) vezi comenzile **neplanificate** — ce încă nu e pe nicio rută.
4. Adaugă comenzile pe o rută sau mută opririle.
   - Pe **calculator (ecran mare):** poți trage o comandă cu mouse-ul (ține apăsat, mută, eliberează).
   - Pe **telefon / tabletă:** folosește **butoanele** de pe ecran (Adaugă, Mută, Sus, Jos…). Nu e obligatoriu să tragi cu degetul.
5. Când ruta e gata, apasă acțiunea de **lansare**. Sistemul poate genera un **cod UIT**. Pe multe instalări acesta e un cod de **test (stub)**, nu de la ANAF.
6. Emite CMR-urile pe opriri dacă fluxul firmei o cere (butonul din ecranul rutei).

`[SCREENSHOT: Dispecerat — evidențiază selectorul de dată, lista de comenzi neplanificate, o rută cu opriri și butonul de lansare]`

`[GIF: tragerea unei comenzi pe o rută pe desktop, apoi aceeași acțiune făcută cu buton]`

Detalii curse izolate: [Gestionarea curselor](../features/shipment-management.md).

---

## Cum rulez Planning AI și promovez un scenariu

**De ce:** calculatorul propune un plan de rute. Tu decizi dacă îl aplici. Fără **promovare**, ziua din Dispecerat **nu** se schimbă.

1. În meniu, apasă **Planning AI**.
2. Setează **ziua** și eventualii parametri afișați pe ecran.
3. Apasă butonul de **rulare / optimizare** (solve). Așteaptă — poate dura câteva momente.
4. Citește scenariul: câte rute, km, timp, cost (dacă există tarife).
5. Dacă ai mai multe scenarii, compară-le pe ecran.
6. Apasă **Promovează** pe scenariul ales.
7. Deschide **Dispecerat** pe aceeași zi și verifică rutele create.

**Atenție:** promovarea e **refuzată** dacă pe zi există deja rute lansate, în execuție sau finalizate. În acel caz nu forța — lucrează pe Dispecerat sau pe o zi liberă.

`[SCREENSHOT: Planning AI — evidențiază butonul de rulare și pe cel de promovare]`

Dacă optimizarea eșuează → [Depanare](../troubleshooting.md).

---

## Cum creez și urmăresc o cursă

**De ce:** cursa leagă marfa, șoferul, documentele și statusul până la livrare.

1. În meniu, apasă **Curse**.
2. Apasă butonul de **cursă nouă** (de obicei sus, în dreapta).
3. Completează **expeditorul** (cine trimite) și **destinatarul** (cine primește): nume, adresă, telefon dacă le ai.
4. Setează **data încărcării** și, dacă o știi, data livrării.
5. Adaugă descrierea mărfii, greutatea, numărul de colete — dacă le știi deja.
6. La **șofer** și **vehicul**, alege din listă. Fără șofer alocat, cursa **nu** apare în App Șofer.
7. Apasă **Salvează**. Statusul tipic după alocare: **Alocată**.

Apoi urmărește statusul din listă sau din detaliu: Încărcată → În tranzit → Livrată. Din detaliu poți genera **linkul de confirmare client**.

`[SCREENSHOT: listă Curse cu filtre și badge-uri de status — evidențiază o cursă Alocată și butonul de creare]`

Vezi și: [Primii 5 minute](../quickstart.md).

---

## Cum lucrez cu CMR pe cursă

**De ce:** fără CMR corect (digital sau scan), biroul și clientul nu au aceeași notă de transport.

1. Deschide **Curse**.
2. Apasă pe cursa dorită (intră în **detaliu**).
3. Derulează până la secțiunea **CMR**.
4. Alege una din cele două căi (nu ambele pe aceeași cursă):
   - **CMR digital:** completează câmpurile, apasă **Salvează ciornă**, semnează pe ecran, apoi **Semnează încărcarea**. La livrare, semnează destinatarul.
   - **Scan hârtie:** încarcă poza / PDF-ul. Asta **dezactivează** formularul digital pe cursă.
5. Verifică greutatea și coletele. La semnarea încărcării pe digital, aceste valori se scriu și pe cursă.
6. Dacă trebuie confirmare de la client, generează / copiază **linkul** din secțiunea de confirmare.

`[SCREENSHOT: detaliu cursă — panel CMR digital cu butoane Salvează ciornă și Semnează]`

---

## Cum văd planul de încărcare pe o rută reală

Ecranul din meniu se numește **Încărcare** (titlu pe pagină: *Plan de încărcare*).

**De ce:** înainte să plece camionul, vrei să vezi **unde stă marfa pe lungime**, pe compartimente, și dacă e prea greu pe o parte.

**Diferență față de Plan 2D:** aici planul vine din **ruta reală** a firmei (comenzi deja pe vehicul). Nu tragi paleții cu mouse-ul — sistemul **calculează** așezarea. Pentru tragere manuală pe desen, vezi secțiunea [Plan 2D](#cum-aranjez-marfa-pe-plan-2d-vizualizare-și-tragere).

1. În meniul din stânga, apasă **Încărcare**.
2. În panoul **Flotă**, scrie în căsuța de căutare **numărul de înmatriculare**, marca sau modelul (ex. `B 123`, `Actros`).
3. Apasă pe vehiculul din listă. Rămâne evidențiat (fundal închis).
4. Sub listă apare **Rute cu acest vehicul**. Apasă pe ruta zilei (cod + dată + număr de opriri).
5. Așteaptă mesajul „Calculez încărcarea…”.
6. Pe mijlocul ecranului apare:
   - **Profilul vehiculului** cu compartimente (bare de umplere) — poți apăsa un compartiment ca să filtrezi lista;
   - **Vedere laterală** a cutiei (unde stau coletele pe lungime).
7. Sus poți comuta strategia:
   - **Ordine șofer** — ultima oprire se încarcă prima (se descarcă în ordinea livrărilor);
   - **Ordine depozit** — grupat pe SKU / zonă de picking (mai rapid la încărcare în depozit).
8. Citește panourile din dreapta: colete pe opriri, greutate, eventuale **avertismente** (ex. echilibru stânga/dreapta).

`[SCREENSHOT: Plan de încărcare — evidențiază căutarea de vehicul, lista de rute, profilul cu compartimente și vederea laterală]`

`[SCREENSHOT: aceleași ecran — evidențiază butoanele Ordine șofer / Ordine depozit și un avertisment]`

Dacă nu apare nicio rută: vehiculul nu are rută alocată pe Dispecerat pentru zilele afișate. Întâi planifică ruta, apoi revino aici.

---

## Cum aranjez marfa pe Plan 2D (vizualizare și tragere)

Ecranul din meniu se numește **Plan 2D** (titlu pe pagină: *Planificator 2D încărcare*).

**De ce:** vrei să **vezi camionul de sus și din lateral** și să pui tu fiecare palet / cutie pe desen — ca pe o masă de planșă, dar pe ecran.

**Important pentru începători:**

| Pe calculator | Pe telefon / ecran mic |
|---------------|-------------------------|
| Poți **trage** marfa din listă pe desen (drag-and-drop) | Tragerea poate fi greoaie — folosește butonul **Plasează** / **+1** de pe fiecare rând |
| După plasare, poți **muta** cutia pe desen ținând mouse-ul apăsat | Preferă butoanele din panoul de selecție |

Tragerea **nu** e singura cale. Fiecare rând de marfă are și **buton** — folosește-l dacă mouse-ul ți se pare nesigur.

### Pași: deschidere și vedere

1. În meniul din stânga, apasă **Plan 2D**.
2. Sus, din lista **Vehicul**, alege tipul de camion / remorcă (șablon).
3. Alege cum vrei să vezi cutia:
   - **Sus** — privire de deasupra (hartă a podelei);
   - **Lateral** — privire din profil (înălțime);
   - **Ambele** — cele două vederi una sub alta (recomandat la început).
4. În stânga / pe panoul de comenzi vezi lista de **mărfuri de încărcat** (poate începe cu date demonstrative pe mediul de demonstrație).

`[SCREENSHOT: Plan 2D — evidențiază selectorul de vehicul, butoanele Sus / Lateral / Ambele și desenul camionului]`

### Pași: adaugi marfă pe camion

1. În lista de comenzi, găsește rândul mărfii (are număr, client, dimensiuni, kg).
2. **Varianta cu mouse (desktop):**
   1. Apasă pe rând și **ține apăsat** butonul stâng al mouse-ului.
   2. Trage până **deasupra desenului** camionului (zona „Vedere de sus” sau lateral).
   3. Eliberează butonul. Marfa se „lipește” (snap) de pereți / de alte colete.
3. **Varianta cu buton (recomandată dacă ești nesigur pe tragere):**
   1. Pe același rând, apasă butonul de tip **Plasează** / **+1**.
   2. Aplicația pune o unitate într-un loc liber.
4. Repetă până cifrele de pe rând arată că ai plasat tot (ex. `3/3`).
5. Dacă vrei totul dintr-o dată, apasă **Auto load**. Aplicația încearcă să umple singură. Ce **nu încape** apare într-un chenar galben, cu motivul („mai înalt decât cutia” / „nu mai este loc”).

`[GIF: tragerea unui palet din listă pe vederea de sus, apoi aceeași acțiune cu butonul +1]`

`[SCREENSHOT: listă de marfă cu buton Plasează și chenarul galben cu unități neîncăpute după Auto load]`

### Pași: muti, rotești, ștergi

1. **Selectează** o cutie: apasă pe ea pe desen. Devine evidențiată.
2. **Mută:** ține apăsat pe cutie și trage pe desen. Poziția se potrivește singură de pereți.
3. **Rotește:** cu cutia selectată, apasă tasta **R** pe tastatură (sau butonul de rotație din panoul din dreapta, dacă e afișat).
4. **Șterge o piesă:** selecteaz-o, apoi tasta **Delete** / **Backspace**, sau butonul de scoatere din panou / din listă.
5. **Golește tot:** butonul **Golește** de pe panoul Vehicul — folosește-l doar dacă vrei să o iei de la zero.
6. **Undo / Redo:** butoanele de pe bară (sau Ctrl+Z / Ctrl+Y pe Windows) ca să anulezi ultima greșeală.

`[SCREENSHOT: cutie selectată pe vedere de sus — evidențiază panoul de selecție din dreapta și butoanele Undo / Auto load]`

### Ce mai vezi pe ecran

- **Statistici** — kg folosite, spațiu, locuri de palet.
- **Validare** — erori (coliziuni, depășiri). Nu ignora lista roșie înainte de a da planul la depozit.
- **Export / Import** — salvează planul într-un fișier pe calculator sau reîncarcă unul salvat anterior.

### Cele două ecrane, pe scurt

| | **Încărcare** | **Plan 2D** |
|--|---------------|-------------|
| De unde vine marfa | Ruta reală din Dispecerat | Listă / plan (inclusiv demonstrație) |
| Cum se așază | Calcul automat (LIFO / depozit) | Tu tragi sau apeși Plasează / Auto load |
| Ce vezi | Profil compartimente + vedere laterală | Vedere sus + lateral pe desen interactiv |

---

## Cum încarc și confirm avize

**De ce:** Anexa și rapoartele se hrănesc din documente **confirmate**, nu din poze netratate.

1. Deschide **Avize / Rapoarte**.
2. Încarcă unul sau mai multe fișiere (lot) — PDF sau imagini.
3. Rulează **extragerea OCR** pe lot (butonul din ecran).
4. Deschide documentele marcate pentru **revizuire** (încredere mică pe unele câmpuri).
5. Corectează ce e greșit: greutate **brută**, TPO, număr auto, cantitate — **separat** (cantitatea nu e greutatea de pe cântar).
6. Apasă **Confirmă** pe documentele gata.
7. Pentru Excel-ul contractual, bifează documentele, alege șablonul (ex. Anexa RAI) și exportă. Poți filtra **De la șofer** pentru pozele din cabină.

`[SCREENSHOT: Avize — listă cu badge De la șofer și status Extras — evidențiază filtrele și Confirmă]`

Mai mult: [Rapoarte și avize](../features/reporting.md).

---

## Cum verific datele înainte de facturare

**De ce:** o alertă pe ecran e mai ieftină decât o factură greșită.

1. Deschide **Verificări date**.
2. Citește mai întâi **erorile** (apar primele / evidențiate).
3. Apasă pe o constatare: citește ce s-a stricat și ce cursă / document e afectat.
4. Corectează cauza (tarif, km, greutate, legătură cursă–aviz).
5. Reîncarcă lista. Ascunde (dismiss) doar ce ai rezolvat.
6. Verifică și **clopoțelul** din dreapta-sus — acolo ajung în principal erorile.

`[SCREENSHOT: Verificări date — grup pe regulă cu o eroare tarif — evidențiază severitatea]`

---

## Cum urmăresc GPS și excepțiile

**De ce:** întârzierea pe hartă trebuie văzută înainte să sune clientul.

1. Deschide **Tracking GPS**.
2. Pe hartă apar vehiculele cu poziție cunoscută.
3. Deschide panoul de **excepții** / întârzieri dacă e afișat.
4. Pentru o rută încheiată, folosește **replay** (traseu planificat față de urma GPS reală).

`[SCREENSHOT: hartă GPS cu vehicule și un marker de excepție — evidențiază panoul de excepții]`

---

## Cum verific locațiile pe hartă

**De ce:** o adresă greșit „înțeleasă” de calculator pune pinul pe alt sat. Doar **tu** confirmi pinul bun.

1. Deschide **Locații**.
2. Caută adresa sau rulează geocodarea pe cele neverificate (după butoanele din ecran).
3. Uită-te la culoarea / nivelul de încredere.
4. Dacă pinul e greșit, mută-l sau alege un candidat din listă.
5. Marchează ca **verificat** doar când ești sigur.

`[SCREENSHOT: Locații — hartă cu pin și listă de candidați — evidențiază butonul de verificare]`

---

## Cum generez teritorii

**De ce:** împarți locațiile pe zone de lucru (echipe / zile).

1. Deschide **Teritorii**.
2. Setează câți clusteri / zone vrei (parametrul K din ecran).
3. Rulează **preview** (fără salvare) ca să vezi poligoanele.
4. Dacă e ok, aplică generarea.
5. Ajustează manual alocările doar dacă ecranul o permite.

`[SCREENSHOT: Teritorii — hartă cu poligoane colorate — evidențiază preview vs aplicare]`

---

## Cum văd documentele care expiră

**De ce:** ITP, RCA, permis, card tahograf — dacă expiră, camionul stă.

1. Deschide **Documente**.
2. Citește lista de expirări (vehicul / șofer).
3. Actualizează datele din **Flotă** sau **Șoferi**.
4. Opțional: importă fișiere tahograf (`.ddd` etc.) din același modul — statusul poate fi „parțial”, fără analiză completă de încălcări.

Pe **Dashboard** apar și alertele pe 30 de zile.

`[SCREENSHOT: Documente — listă expirări — evidențiază tipul documentului și data]`

---

## Cum lucrez în Financiar (pe scurt)

**De ce:** facturile din Transitix țin evidența internă; UBL-ul e fișier pentru e-Factura, **nu** trimitere automată pe SPV.

1. Deschide **Financiar**.
2. Creează sau deschide o factură legată de cursă / client.
3. Completează liniile și salvează.
4. Folosește **Descarcă UBL** când ai nevoie de fișierul XML local.
5. Nu interpreta UBL-ul ca „acceptat de ANAF”.

Detalii tarife: [Flotă, șoferi și tarife](../features/carrier-management.md).

`[SCREENSHOT: Financiar — factură cu buton Descarcă UBL]`

---

## Vezi și

- [Ghid șofer](driver-guide.md)
- [Gestionarea curselor](../features/shipment-management.md)
- [Rapoarte și avize](../features/reporting.md)
- [Depanare](../troubleshooting.md)
- [Glosar](../glossary.md)
