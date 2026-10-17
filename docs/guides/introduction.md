# Introducere în Transitix

## Cuprins

1. [Ce este Transitix?](#ce-este-transitix)
2. [Ce probleme rezolvă](#ce-probleme-rezolvă)
3. [Roluri](#roluri)
4. [Module principale](#module-principale)
5. [Cerințe și acces](#cerințe-și-acces)
6. [Prima privire asupra ecranului](#prima-privire-asupra-ecranului)
7. [Unde mergi mai departe](#unde-mergi-mai-departe)

---

## Ce este Transitix?

Transitix este un **sistem de management al transportului (TMS)** pentru firme de logistică rutieră.

Te ajută să planifici curse, să aloci șoferi și vehicule, să urmărești execuția pe drum și să pregătești documentele și rapoartele pentru facturare — într-un singur loc, pe firmă (multi-tenant).

## Ce probleme rezolvă

| Nevoie | Cum răspunde Transitix |
|--------|------------------------|
| Știu ce curse am azi? | Dashboard + listă **Curse** + **Dispecerat** pe zi |
| Cum optimizez rutele? | **Planning AI** (scenarii) → promovare în Dispecerat |
| Unde e camionul? | **Tracking GPS** (poziții live, excepții, replay) |
| Ce a încărcat șoferul? | **App Șofer** (status, CMR digital, poze pe lot) + **Avize** (OCR) |
| Ce facturez? | **Config. comercială** (tarife) + **Financiar** + **Rapoarte** / Anexa |
| Ce documente expiră? | **Documente** + alerte pe Dashboard / clopoțel |

## Roluri

| Rol | Ce face în practică | Unde lucrează |
|-----|---------------------|---------------|
| **Administrator** (`admin`) | Configurează firma, utilizatorii, tarifele; vede jurnalul | Tot meniul birou + Utilizatori + Jurnal |
| **Dispecer** (`dispatcher`) | Planifică, alocă, urmărește, verifică documente | Meniul birou (fără Utilizatori / Jurnal) |
| **Financiar** (`finance`) | Facturi, UBL, rapoarte comerciale | Același meniu birou ca dispecerul |
| **Șofer** (`driver`) | Execută cursa pe telefon | Doar **App Șofer** (`/driver-app`) |
| **Client / destinatar** | Confirmă recepția mărfii | Link public `/confirm/…` (fără cont obligatoriu) |

După autentificare, șoferul ajunge direct în App Șofer. Utilizatorii de birou ajung pe Dashboard.

## Module principale

Meniu birou (stânga):

| Modul | Scop scurt |
|-------|------------|
| Dashboard | KPI, curse recente, documente pe cale să expire |
| Dispecerat | Comenzi, rute pe zi, lansare, UIT |
| Încărcare | Plan de încărcare pe **ruta reală**: alegi vehiculul și ruta, vezi compartimentele și vederea laterală (calcul automat LIFO / depozit) |
| Plan 2D | Planificator vizual: camion **de sus și din lateral**, adaugi marfa prin **tragere (drag-and-drop)** sau butonul **Plasează 1**, Auto load, Undo |
| Curse | Listă și detaliu cursă (CMR, UIT, avize, link client) |
| Flotă / Șoferi | Resursele tale |
| Locații / Teritorii | Adrese geocodate și zone |
| Tracking GPS | Hartă live și istoric |
| Planning AI | Optimizare rute (scenarii) |
| Clienți | Parteneri |
| Financiar | Facturi și export UBL |
| Depozit | Stoc (WMS simplu) |
| Documente | Expirări, CMR de confirmat, import tahograf |
| Avize / Rapoarte | OCR avize, Anexa XLSX |
| Rapoarte | Export pe șablon, cu istoric |
| Verificări date | Alerte pe TPO, tarife, greutăți |
| Config. comercială | Tarife, zone, taxe, garaj |
| Utilizatori / Jurnal | Doar admin |

Detalii pe sarcini: [Ghid dispecer](user-guides/dispatcher-guide.md) — include pași lenți pentru **Încărcare**, **Plan 2D** (tragere pe desen), Dispecerat, GPS, avize etc.

## Cerințe și acces

- **Browser** modern (Chrome, Edge, Firefox, Safari actualizate).
- **Cont** pe firma ta (email + parolă). Înregistrare: `/register`. Reset: „Ai uitat parola?”.
- **Ecran:** biroul e folosit pe desktop și tabletă; App Șofer e gândită pentru telefon.
- **Rețea:** geocodarea, rutarea (OSRM) și Planning AI depind de serviciile configurate pe server. Dacă Planning sau distanțele nu răspund, vezi [Depanare](troubleshooting.md).

`[TODO: verify with development team]` — URL-ul de producție, cerințele de hosting și politica de backup pentru clienți.

Mediul local tipic (dezvoltare): interfață pe port **5173**, API pe **3001**.

## Prima privire asupra ecranului

După login ca utilizator de birou vezi Dashboard-ul.

`[SCREENSHOT: Dashboard Transitix — evidențiază (1) logo și meniu stânga, (2) căutare globală în antet, (3) clopoțel notificări, (4) carduri KPI, (5) curse recente, (6) alerte documente]`

| Zonă | La ce servește |
|------|----------------|
| Meniu stânga | Navigare între module |
| Căutare | Găsești rapid curse / entități |
| Clopoțel | Alerte importante (ex. erori de facturare, CMR de confirmat) |
| KPI / cockpit | Punctualitate, km, cost — când există date și tarife |
| Curse recente | Intrare rapidă în detaliu |
| Documente expirând | ITP, RCA, permis etc. în 30 de zile |

Ghidul din aplicație (buton **Ghid** din meniu) te plimbă o dată prin modulele biroului.

## Unde mergi mai departe

- [Primii 5 minute](quickstart.md) — de la zero la o cursă urmărită
- [Ghid dispecer](user-guides/dispatcher-guide.md)
- [Ghid șofer](user-guides/driver-guide.md)
- [Glosar](glossary.md)
