# Ghiduri utilizator Transitix

Documentația descrie **ce poți face** în Transitix, pe sarcini, nu pe butoane izolate.

Scrisă în română, cu pași scurți — potrivită și dacă nu ești obișnuit cu aplicații noi. Termenii sunt cei din interfață: *cursă*, *CMR*, *aviz*, *dispecerat*, *Plan 2D*.

Dacă un ecran are și **tragere cu mouse-ul** (drag-and-drop), ghidul explică și **butonul alternativ** — pe telefon sau dacă tragerea ți se pare grea, folosește butonul.
## Cum citești ghidurile

1. Dacă ești nou → începe cu [Introducere](introduction.md), apoi [Primii 5 minute](quickstart.md).
2. Dacă ai un rol clar → deschide ghidul din [Ghiduri pe rol](#ghiduri-pe-rol).
3. Dacă cauți un flux anume (curse, rapoarte, flotă) → [Ghiduri pe funcționalitate](#ghiduri-pe-funcționalitate).
4. Dacă ceva nu merge → [Depanare](troubleshooting.md).
5. Dacă un cuvânt e necunoscut → [Glosar](glossary.md).

## Ghiduri pe rol

| Rol | Fișier | Pentru cine |
|-----|--------|-------------|
| Dispecer / birou operațiuni | [dispatcher-guide.md](user-guides/dispatcher-guide.md) | Planificare, curse, **Încărcare**, **Plan 2D** (tragere marfă), documente, GPS |
| Șofer | [driver-guide.md](user-guides/driver-guide.md) | App Șofer: status, CMR, POD |
| Client (destinatar) | [customer-guide.md](user-guides/customer-guide.md) | Link de confirmare recepție |
| Administrator | [admin-guide.md](user-guides/admin-guide.md) | Utilizatori, setări, jurnal |

Rolurile din sistem: `admin`, `dispatcher`, `finance`, `driver`. Biroul (`admin` / `dispatcher` / `finance`) vede aproape același meniu. Doar **admin** are *Utilizatori* și *Jurnal modificări*.

## Ghiduri pe funcționalitate

| Temă | Fișier |
|------|--------|
| Curse și CMR | [shipment-management.md](features/shipment-management.md) |
| Flotă, șoferi, tarife | [carrier-management.md](features/carrier-management.md) |
| Avize, rapoarte, verificări | [reporting.md](features/reporting.md) |
| Setări firmă | [settings.md](features/settings.md) |

## Convenții în text

- Pașii sunt numerotați (maxim 7 pe sarcină).
- `[SCREENSHOT: …]` și `[GIF: …]` marchează locuri pentru capturi — de completat la redactarea vizuală.
- `[TODO: verify with development team]` marchează un detaliu neconfirmat în cod sau pe mediul de producție.

## Ce nu e „gata” în produs

Nu documentăm ca livrate: ANAF e-Transport live, trimitere e-Factura pe SPV, decode complet tahograf Reg. 561, navigație offline, dark mode cu toggle, chat real birou↔șofer. Detalii în ghiduri unde apar.
