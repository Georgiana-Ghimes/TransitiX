# Ghid client (confirmare recepție)

## Cuprins

1. [Pentru cine e acest ghid](#pentru-cine-e-acest-ghid)
2. [Cum să… (index rapid)](#cum-să--index-rapid)
3. [Cum deschid linkul de confirmare](#cum-deschid-linkul-de-confirmare)
4. [Cum confirm primirea mărfii](#cum-confirm-primirea-mărfii)
5. [Cum raportez o problemă la livrare](#cum-raportez-o-problemă-la-livrare)
6. [Ce nu face acest portal](#ce-nu-face-acest-portal)

---

## Pentru cine e acest ghid

Pentru **destinatar** (sau reprezentantul lui) care a primit un **link de confirmare** de la transportator.

Nu ai nevoie de cont Transitix. Linkul e personal și are termen de valabilitate (în UI: tipic **30 de zile**).

## Cum să… (index rapid)

- [Cum deschid linkul?](#cum-deschid-linkul-de-confirmare)
- [Cum confirm că am primit marfa?](#cum-confirm-primirea-mărfii)
- [Cum semnalez avarii?](#cum-raportez-o-problemă-la-livrare)

---

## Cum deschid linkul de confirmare

**De ce:** fără linkul primit pe email / mesaj, portalul nu știe ce cursă să arate.

1. Deschide linkul din mesajul transportatorului (începe de obicei cu adresa firmei + `/confirm/…`).
2. Așteaptă încărcarea paginii.
3. Verifică pe ecran: număr CMR, expeditor, destinatar, greutate, colete.

`[SCREENSHOT: portal client — antet cu număr CMR și datele părților — evidențiază CMR-ul]`

Dacă pagina spune că linkul e invalid sau expirat, contactează transportatorul pentru un link nou.

---

## Cum confirm primirea mărfii

**De ce:** confirmarea închide bucla pentru birou (recepție fără contestare pe această notă).

1. Citește datele cursei. Dacă ceva e greșit înainte de confirmare, contactează transportatorul — **nu** confirma.
2. Completează observațiile dacă e cazul (opțional, dacă totul e în regulă).
3. Apasă **Confirm primirea mărfii** (sau eticheta echivalentă de pe ecran).
4. Așteaptă mesajul de succes.

`[SCREENSHOT: formular confirmare — evidențiază câmpul observații și butonul Confirm primirea mărfii]`

---

## Cum raportez o problemă la livrare

**De ce:** avaria nedeclarată la confirmare e greu de reclamat ulterior.

1. Pe același formular, marchează că există **avarii** / daune (dacă opțiunea e afișată).
2. Descrie pe scurt problema.
3. Adaugă poza, dacă eceranul o cere / o permite.
4. Confirmă trimiterea împreună cu formularul.

`[SCREENSHOT: secțiune avarii pe portal — evidențiază checkbox-ul și câmpul de descriere]`

Transportatorul vede semnalarea pe birou (notificări / detaliu cursă).

---

## Ce nu face acest portal

| Așteptare | Realitate în Transitix |
|-----------|-------------------------|
| Tracking live pe hartă | Nu — vezi datele cursei din link, nu GPS live |
| Cont și istoric pe mai multe curse | Nu — un link = o confirmare |
| Descărcare PDF CMR | Poate apărea un buton pe ecran; **descărcarea nu e confirmată ca funcțională** |

`[TODO: verify with development team]` — starea butonului „Descarcă PDF CMR” pe mediul de producție.

Pentru urmărirea camionului, cere actualizări dispecerului firmei de transport.

---

## Vezi și

- [Glosar — CMR](../glossary.md#cmr)
- [Gestionarea curselor](../features/shipment-management.md) (perspectiva biroului)
