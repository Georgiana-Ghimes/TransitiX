# Ghid șofer (App Șofer)

## Cuprins

1. [Pentru cine e acest ghid](#pentru-cine-e-acest-ghid)
2. [Cum să… (index rapid)](#cum-să--index-rapid)
3. [Cum mă autentific și ce văd](#cum-mă-autentific-și-ce-văd)
4. [Cum actualizez statusul cursei](#cum-actualizez-statusul-cursei)
5. [Cum completez CMR digital](#cum-completez-cmr-digital)
6. [Cum trimit poze pe lot (aviz / cântar)](#cum-trimit-poze-pe-lot-aviz--cântar)
7. [Cum folosesc ruta zilei și POD](#cum-folosesc-ruta-zilei-și-pod)
8. [Notificări, chat, profil](#notificări-chat-profil)

---

## Pentru cine e acest ghid

Pentru conturi cu rol **șofer**. După login ajungi automat pe App Șofer. Nu ai acces la meniul de birou.

## Cum să… (index rapid)

- [Cum văd cursele mele?](#cum-mă-autentific-și-ce-văd)
- [Cum marchează „Am încărcat” / „Am livrat”?](#cum-actualizez-statusul-cursei)
- [Cum semnez CMR-ul pe telefon?](#cum-completez-cmr-digital)
- [Cum trimit poza de pe cântar la birou?](#cum-trimit-poze-pe-lot-aviz--cântar)
- [Cum confirm livrarea cu semnătură (POD)?](#cum-folosesc-ruta-zilei-și-pod)

---

## Cum mă autentific și ce văd

**De ce:** App Șofer arată doar cursele **alocate ție**.

1. Deschide Transitix pe telefon.
2. Autentifică-te cu emailul și parola de șofer.
3. Folosește tab-urile de jos: **Rută**, **Curse**, **Notificări**, **Chat**, **Profil**.

`[SCREENSHOT: App Șofer — bara de tab-uri — evidențiază tab-urile Rută și Curse]`

| Tab | Rol |
|-----|-----|
| Rută | Opririle zilei, navigare, POD |
| Curse | Lista curselor tale (active / istoric) |
| Notificări | Mesaje despre curse și sistem |
| Chat | Mesaje (vezi limita de mai jos) |
| Profil | Date personale, logout |

---

## Cum actualizez statusul cursei

**De ce:** biroul și clientul văd progresul din statusul pe care îl marchezi tu.

1. Deschide tab-ul **Curse**.
2. Alege cursa activă.
3. Apasă butonul principal al etapei:
   1. **Am încărcat** (din Alocată → Încărcată)
   2. **Am plecat** (→ În tranzit)
   3. **Am livrat** (→ Livrată)
4. Verifică badge-ul de status după fiecare apăsare.

`[SCREENSHOT: detaliu cursă șofer — evidențiază butonul Am încărcat și fluxul de status]`

Maxim un buton principal pe etapă — nu sări etape fără motiv.

---

## Cum completez CMR digital

**De ce:** dacă nu ai hârtie, CMR-ul scris pe telefon e documentul oficial al cursei.

1. Deschide cursa.
2. Derulează la **CMR digital**.
3. Verifică datele precompletate (expeditor, destinatar, transportator).
4. Completează ce ai văzut la rampă: colete, greutate, natură, rezerve.
5. Semnează pe ecran (expeditor + transportator la încărcare).
6. Apasă **Semnează încărcarea**. La livrare, completează rezervele și semnătura destinatarului.
7. Poți **Salva ciornă** înainte de semnare.

`[SCREENSHOT: CMR digital pe telefon — evidențiază câmpul Greutate brută și pad-ul de semnătură]`

**Dacă vezi mesajul că există deja un CMR scanat:** formularul digital e oprit. Nu încerca să forțezi o a doua variantă — vorbește cu dispecerul.

La semnarea încărcării, greutatea / coletele / natura se scriu pe cursă pentru birou.

---

## Cum trimit poze pe lot (aviz / cântar)

**De ce:** poza trebuie să ajungă în coada de OCR a biroului, nu să rămână doar pe telefon.

1. Pe aceeași cursă, deschide secțiunea **Documente pe lot**.
2. Alege tipul: Aviz / cântar, Poză CMR sau Alt document.
3. Apasă **Încarcă pe lot** și fă poza (sau alege din galerie).
4. Verifică lista: fișierul apare cu status (încărcat / extras / de revizuit).

`[SCREENSHOT: secțiune Documente pe lot — evidențiază tipul documentului și butonul Încarcă pe lot]`

OCR-ul pornește pe server în fundal. Dispecerul vede documentele pe **Avize**, cu eticheta „De la șofer”.

---

## Cum folosesc ruta zilei și POD

**De ce:** pe rute cu mai multe opriri, POD-ul leagă semnătura de **oprire**, nu doar de o cursă abstractă.

1. Deschide tab-ul **Rută**.
2. Vezi opririle în ordine.
3. Folosește **Navigare** când pleci spre următoarea adresă.
4. La livrare / ridicare, deschide acțiunea de finalizare.
5. Completează **POD**: semnătură pe ecran și/sau foto, sau marchează refuzul cu motiv.
6. Confirmă.

`[SCREENSHOT: Rută zilei cu o oprire de livrare — evidențiază acțiunea POD / Gata]`

Aplicația poate raporta poziția GPS în timpul zilei (când browserul are drept de locație).

---

## Notificări, chat, profil

### Notificări

Deschide tab-ul **Notificări** pentru curse noi, schimbări de status și mesaje de sistem. Marchează citite după ce le-ai văzut.

### Chat

Tab-ul **Chat** permite mesaje pe cursă. **Important:** răspunsurile automate din aplicație pot fi **simulate** — nu înlocuiesc un dispecer real. Pentru urgențe, sună biroul pe numărul firmei.

`[TODO: verify with development team]` — dacă pe mediul vostru chatul e conectat la un canal real birou↔șofer.

### Profil

Din **Profil** vezi datele tale și te **deconectezi**. La deconectare ești scos din sesiune.

---

## Vezi și

- [Ghid dispecer](dispatcher-guide.md) — ce face biroul cu pozele și CMR-ul tău
- [Gestionarea curselor](../features/shipment-management.md)
- [Depanare](../troubleshooting.md)
