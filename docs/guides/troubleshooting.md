# Depanare

## Cuprins

1. [Probleme frecvente](#probleme-frecvente)
2. [Mesaje / situații și ce înseamnă](#mesaje--situații-și-ce-înseamnă)
3. [Pe cine contactezi](#pe-cine-contactezi)

---

## Probleme frecvente

### 1. Nu mă pot autentifica

**De ce apare:** parolă greșită, cont inactiv, sesiune veche blocată.

1. Verifică emailul (fără spații) și Caps Lock.
2. Folosește **Ai uitat parola?** și urmează linkul.
3. Dacă pe mediul local vezi un `reset_link` pe ecran după cerere, deschide-l manual (emailul poate fi în mod stub).
4. Cere adminului să verifice că ești **activ** în **Utilizatori**.

`[SCREENSHOT: Login cu mesaj de eroare — evidențiază linkul Ai uitat parola]`

### 2. Cursa nu apare la șofer

**De ce apare:** cursa nu e alocată pe șoferul din cont, sau te-ai autentificat pe cont greșit.

1. Pe birou, deschide cursa: verifică **șoferul** alocat.
2. Verifică în **Șoferi** că profilul e legat de **același user** cu care se autentifică pe telefon.
3. Statusul trebuie să permită execuția (tipic **Alocată** sau următorii).
4. Cere șoferului să tragă în jos lista / să reîmprospăteze App Șofer.
5. Confirmă că rolul contului e `driver` (altfel e redirecționat pe birou).

### 3. CMR digital e dezactivat

**De ce apare:** pe cursă există deja un **CMR scanat**. Aplicația evită două note contradictorii.

1. Deschide detaliul cursei pe birou.
2. Dacă scanul e greșit, tratează-l pe calea de scan/OCR — nu forța digitalul.
3. Dacă trebuia digital de la început, nu încărca scan pe aceeași cursă.

Vezi: [Gestionarea curselor — CMR](features/shipment-management.md#cmr-digital-vs-scan).

### 4. Avizul nu poate fi confirmat

**De ce apare:** câmpuri obligatorii încă „lipsă” după OCR, sau corecția a fost salvată pe un nume de câmp greșit (cazuri vechi).

1. Deschide documentul în **Avize**.
2. Completează câmpurile marcate pentru revizuire (mai ales greutate brută, TPO, placă).
3. Salvează corecțiile.
4. Încearcă din nou **Confirmă**.
5. Folosește **force** doar dacă politica firmei o permite și știi de ce.

### 5. „Fără tarif” / TPO 0 pe verificări

**De ce apare:** nu există tarif **valabil la data cursei** pentru clasa vehiculului.

1. Deschide **Verificări date** și notează clasa / data.
2. Mergi la **Config. comercială**.
3. Adaugă sau extinde tariful pe perioada potrivită.
4. Recalculează / reîncarcă verificările.
5. Dacă tot e 0, verifică dacă pe cursă e setată clasa corectă a vehiculului.

### 6. Planning AI nu rulează / distanțe lipsă

**De ce apare:** motorul de rutare (OSRM) sau solverul nu e disponibil pe server.

1. Citește mesajul din UI (deseori spune că serviciul lipsește).
2. Contactează pe cine administrează serverul (OSRM / VROOM trebuie să ruleze).
3. Nu inventa km manual ca „optimizare” — distanțele de plan trebuie să vină pe același drum ca restul sistemului.

`[TODO: verify with development team]` — URL-urile și health-check-urile exacte pe mediul vostru.

### 7. UIT-ul arată „STUB-…” sau nu e „de la ANAF”

**De ce apare:** modul e-Transport e pe **stub** (implicit în multe instalări).

1. Consideră codul valid doar pentru teste interne.
2. Pentru producție ANAF, cere echipei tehnice activarea adaptării reale (`ETRANSPORT_MODE` / credențiale).
3. Nu raporta stub-ul ca UIT oficial către autorități.

### 8. Am descărcat UBL — factura nu e „trimisă pe e-Factura”

**De ce apare:** UBL-ul e **export local**. SPV-ul nu e conectat.

1. Folosește fișierul în fluxul vostru extern de e-Factura, dacă există.
2. Nu marca mental factura ca „acceptată ANAF” doar pentru că ai UBL.
3. Statusurile din **Financiar** (draft / sent / paid) sunt ale firmei în Transitix, nu verdict SPV.

### 9. Resetarea parolei nu îmi vine pe email

**De ce apare:** pe multe medii de dezvoltare, emailul e **stub** — linkul apare în răspunsul din UI.

1. După „Am uitat parola”, citește tot ecranul (inclusiv un eventual link afișat).
2. Cere adminului să regenereze invitația / resetul.
3. Pe producție, confirmă cu echipa că providerul de email e configurat.

### 10. Documentele expirate nu apar / apar prea târziu

**De ce apare:** lipsesc datele de expirare pe flotă/șofer, sau pragul din Setări e altul decât te aștepți.

1. Completează expirările pe **Flotă** și **Șoferi**.
2. Verifică pragul în **Setări**.
3. Reîncarcă Dashboard / Documente.

### 11. La Încărcare nu văd nicio rută / planul e gol

**De ce apare:** vehiculul ales nu are rută alocată pe Dispecerat, sau nu ai apăsat pe o rută din listă.

1. Verifică pe **Dispecerat** că vehiculul e pe o rută în ziua respectivă.
2. Pe **Încărcare**, caută din nou placa, selectează vehiculul, apoi **apasă pe o rută** din lista de sub flotă.
3. Așteaptă „Calculez încărcarea…”.

### 12. Pe Plan 2D nu știu să adaug marfa / tragerea nu merge

**De ce apare:** pe ecran mic drag-and-drop e greu; sau nu ai eliberat mouse-ul deasupra desenului.

1. Folosește butonul **Plasează 1** de pe rândul mărfii — nu e nevoie să tragi.
2. Pe calculator: ține apăsat pe rând, trage **până peste** zona „Vedere de sus”, apoi eliberează.
3. Dacă tot nu apare, apasă **Auto load** și citește chenarul galben cu ce nu a încăput.
4. Pași detaliați: [Ghid dispecer — Plan 2D](user-guides/dispatcher-guide.md#cum-aranjez-marfa-pe-plan-2d-vizualizare-și-tragere).

---

## Mesaje / situații și ce înseamnă

| Situație | Semnificație | Ce faci |
|----------|--------------|---------|
| CMR incomplet pentru etapă | Lipsesc câmpuri sau semnături obligatorii | Completează greutatea/coletele și semnează |
| Semnează mai întâi încărcarea | Încerci livrarea fără încărcare semnată | Semnează etapa de încărcare |
| Lot / document needs review | OCR nesigur pe unele câmpuri | Corectează manual, apoi confirmă |
| Promovare Planning refuzată | Pe zi există rute deja lansate / în execuție | Nu promova peste o zi „aprinsă” |
| De la șofer (badge) | Document încărcat din App Șofer | Revizuiește ca pe orice aviz |
| OCR stub (pe scan CMR vechi) | Extragerea nu e din Vision real | Verifică manual datele |

---

## Pe cine contactezi

| Problemă | Contact |
|----------|---------|
| Parolă, rol, cont inactiv | **Administratorul** firmei în Transitix |
| Cursă greșită, alocare, documente pe teren | **Dispecerul** |
| Tarif, factură, Anexa | **Financiar** / admin comercial |
| Server jos, OSRM, email, ANAF/SPV | **Echipa tehnică** care găzduiește Transitix |

`[TODO: verify with development team]` — email / telefon support oficial pentru clienții Transitix pe producție.

---

## Vezi și

- [Primii 5 minute](quickstart.md)
- [Ghid dispecer](user-guides/dispatcher-guide.md)
- [Ghid șofer](user-guides/driver-guide.md)
- [Glosar](glossary.md)
