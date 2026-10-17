# 22. Rezultatele pe care le urmărim

Toți indicatorii din manual, adunați într-un loc, grupați după întrebarea la care răspund.

Fiecare are **ținta** și **unde îl vezi**.

## Operațional — camioanele merg cum trebuie

| Indicator | Țintă | Unde |
|-----------|-------|------|
| Documente expirate | **0** | [Dashboard](03-dashboard.md), [Documente](10-documente.md) |
| Punctualitate | În creștere sau stabilă | [Dashboard](03-dashboard.md) |
| Km plan vs realizat | Diferență mică | [Dashboard](03-dashboard.md), [GPS](09-tracking-gps.md) |
| Comenzi neplanificate la sfârșitul zilei | **0** | [Dispecerat](04-dispecerat.md) |
| Grad de umplere pe rută | Cât mai mare | [Încărcare](05-incarcare.md) |
| Depășiri de sarcină pe axă | **0** — limită, nu obiectiv | [Încărcare](05-incarcare.md) |
| Curse blocate într-un status intermediar | **0** peste noapte | [Curse](06-curse.md) |
| Curse în „Problemă" nerezolvate | **0** | [Curse](06-curse.md) |
| Grad de utilizare a flotei | Cât mai mare | [Flotă](07-flota-soferi-clienti.md) |
| Opriri neplanificate | Puține și explicabile | [GPS](09-tracking-gps.md) |
| Goluri în urmărire pe cursă activă | **0** | [GPS](09-tracking-gps.md) |

## Documentar — fiecare cursă are dovada ei

| Indicator | Țintă | Unde |
|-----------|-------|------|
| Curse livrate cu CMR semnat | **100%** | [Curse](06-curse.md), [Verificări](13-verificari.md) |
| Curse livrate cu aviz confirmat și legat | **100%** | [Avize](11-avize.md), [Verificări](13-verificari.md) |
| Avize confirmate fără greutate brută | **0** | [Verificări](13-verificari.md) |
| Avize confirmate nelegate de cursă | **0** | [Verificări](13-verificari.md) |
| TPO-uri duplicate | **0** | [Verificări](13-verificari.md) |
| Timp de la scanare la confirmare aviz | Cât mai scurt | [Avize](11-avize.md) |
| Rată de corectură manuală după OCR | În scădere | [Avize](11-avize.md) |
| Confirmări de recepție de la clienți | Rată mare | [Portal client](18-portal-client.md) |
| Avarii semnalate | **0**, iar când apar — rapid | [Portal client](18-portal-client.md) |
| Importuri tahograf | La zi | [Documente](10-documente.md) |

## Comercial — facturăm ce trebuie, cât trebuie

| Indicator | Țintă | Unde |
|-----------|-------|------|
| Curse fără tarif valabil | **0** | [Verificări](13-verificari.md) |
| TPO fără componentă de kilometri | **0** | [Verificări](13-verificari.md) |
| Total TPO diferit de suma liniilor | **0** | [Verificări](13-verificari.md) |
| Curse modificate după calculul TPO | **0** neexplicate | [Verificări](13-verificari.md) |
| Suprapuneri neintenționate de perioade tarifare | **0** | [Configurare comercială](14-configurare-comerciala.md) |
| Tarife fără notă de proveniență | **0** | [Configurare comercială](14-configurare-comerciala.md) |
| Coduri de observații nerecunoscute | **0** — fiecare e o taxă nefacturată | [Configurare comercială](14-configurare-comerciala.md) |
| Avertismente pe un raport care pleacă la client | **0** | [Rapoarte](12-rapoarte.md) |
| Reveniri de la client cu „cifra nu se potrivește" | **0** | [Rapoarte](12-rapoarte.md) |
| Timp de la livrare la factură | Cât mai scurt | [Financiar](15-financiar.md) |
| Facturi restante | În scădere, ca număr și vechime | [Financiar](15-financiar.md) |
| Contestații pe compunerea facturii | **0** | [Financiar](15-financiar.md) |
| Marjă pe cursă / client / rută | Pozitivă și stabilă | [Curse](06-curse.md), [Financiar](15-financiar.md) |

## Date — fundația pe care stau toate celelalte

| Indicator | Țintă | Unde |
|-----------|-------|------|
| Locații active fără coordonate | **0** | [Locații](08-locatii-teritorii.md) |
| Locații neverificate folosite frecvent | **0** | [Locații](08-locatii-teritorii.md) |
| Garaj setat și geocodat | **Da** | [Configurare comercială](14-configurare-comerciala.md) |
| Vehicule fără clasă comercială | **0** | [Flotă](07-flota-soferi-clienti.md) |
| Vehicule fără costuri completate | **0** | [Flotă](07-flota-soferi-clienti.md) |
| Constatări din Verificări, lună de lună | În scădere | [Verificări](13-verificari.md) |
| Stoc real = stoc din sistem | Egale | [Depozit](16-depozit.md) |
| Produse fără locație | **0** | [Depozit](16-depozit.md) |

## Acces și control — cine ce poate și cine ce a făcut

| Indicator | Țintă | Unde |
|-----------|-------|------|
| Conturi partajate | **0** — fac jurnalul inutil | [Utilizatori](19-utilizatori.md) |
| Administratori activi | **Cel puțin 2** | [Utilizatori](19-utilizatori.md) |
| Conturi active ale unor oameni plecați | **0** | [Utilizatori](19-utilizatori.md) |
| Conturi de șofer nelegate de fișă | **0** | [Utilizatori](19-utilizatori.md) |
| Invitații expirate neurmărite | **0** | [Utilizatori](19-utilizatori.md) |
| Serii de autentificări eșuate | **0** | [Jurnal](20-jurnal.md) |
| Modificări pe curse deja facturate | **0** neexplicate | [Jurnal](20-jurnal.md) |
| Sesiuni necunoscute | **0** | [Setări](21-setari.md) |

## Ordinea în care merită atacate

Dacă totul e roșu deodată, aceasta e ordinea în care rezolvarea unui lucru le repară și pe
următoarele:

1. **Datele de bază** — locații geocodate, garaj, clase comerciale pe vehicule. Fără ele, TPO-ul
   nu poate fi corect, oricât ai încerca mai sus.
2. **Configurarea comercială** — tarife valabile, fără goluri de perioadă.
3. **Documentarul** — avize confirmate și legate, CMR-uri semnate.
4. **Verificările** — rulate înainte de fiecare decont, nu după.
5. **Rapoarte și facturare** — la acest punct sunt deja aproape automate.
6. **Optimizarea operațională** — punctualitate, umplere, kilometri. Aici se câștigă marja, dar
   numai după ce restul e curat.
