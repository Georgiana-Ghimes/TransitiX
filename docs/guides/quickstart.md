# Primii 5 minute cu Transitix

## Cuprins

1. [Ce obții la final](#ce-obții-la-final)
2. [Înainte să începi](#înainte-să-începi)
3. [Pașii](#pașii)
4. [Ce urmează](#ce-urmează)

---

## Ce obții la final

În maxim 7 pași ai:

- o **cursă** creată și alocată;
- status actualizat din perspectiva șoferului (sau înțelegi cum se face);
- o cale clară spre confirmarea clientului.

`[GIF: fluxul de la login birou → cursă alocată → status Încărcată / În tranzit pe App Șofer]`

## Înainte să începi

- Ai un cont de birou (`admin` sau `dispatcher`).
- Știi emailul și parola.
- Ideal: există deja un **vehicul** și un **șofer** în firmă. Dacă nu, îi creezi la pasul 2.

## Pașii

### 1. Autentifică-te

1. Deschide pagina de login Transitix.
2. Introdu emailul și parola.
3. Apasă butonul de autentificare.

Ajungi pe **Dashboard**.

`[SCREENSHOT: ecran Login cu logo Transitix — evidențiază câmpurile email/parolă și butonul de autentificare]`

### 2. Verifică resursele (flotă și șofer)

De ce: fără șofer și vehicul, cursa rămâne pe hârtie — șoferul nu o vede în App Șofer.

1. Deschide **Flotă**. Dacă lista e goală, creează un vehicul (număr, date de bază) și salvează.
2. Deschide **Șoferi**. Dacă e nevoie, creează un șofer și leagă-l de un cont cu rol `driver` (sau cere administratorului invitația).
3. Notează **placa** și **numele șoferului**.

`[SCREENSHOT: listă Flotă cu un vehicul — evidențiază numărul de înmatriculare]`

### 3. Creează prima cursă

De ce: cursa e unitatea de lucru pe care o urmărești până la livrare.

1. Deschide **Curse**.
2. Creează o cursă nouă (butonul de adăugare din ecran).
3. Completează minim: expeditor, destinatar, date de încărcare/livrare, descriere marfă dacă o ai.
4. Salvează.

`[SCREENSHOT: formular cursă nouă — evidențiază câmpurile expeditor, destinatar, salvare]`

Alternativă pe ziua de lucru: începe din **Dispecerat** (comenzi → rută). Pentru primul contact, lista **Curse** e mai simplă.

### 4. Alocă șoferul și vehiculul

De ce: doar cursele alocate apar la șoferul respectiv.

1. Deschide cursa din listă (detaliu) sau editeaz-o.
2. Selectează **șoferul** și **vehiculul**.
3. Setează statusul pe **Alocată** (dacă nu s-a setat automat la salvare).
4. Salvează.

`[SCREENSHOT: detaliu cursă — evidențiază câmpurile șofer, vehicul și badge-ul de status Alocată]`

### 5. (Opțional) Pregătește ruta din Dispecerat

De ce: pe operațiuni reale lucrezi pe **zi** și pe **rute** cu mai multe opriri, nu doar pe o cursă izolată.

1. Deschide **Dispecerat**.
2. Alege ziua.
3. Dacă ai deja rute din Planning AI, verifică-le aici. Altfel poți gestiona opririle și lansarea din acest ecran.
4. La lansare, sistemul poate genera un **cod UIT** (în configurarea implicită poate fi un stub local, nu ANAF live).

`[SCREENSHOT: Dispecerat pe o zi — evidențiază lista de rute și acțiunea de lansare]`

### 6. Actualizează statusul din App Șofer

De ce: biroul vede progresul doar dacă șoferul (sau cineva în numele lui pe cont de șofer) marchează etapele.

1. Autentifică-te cu un cont **șofer** (sau cere șoferului să o facă pe telefon).
2. Deschide tab-ul **Curse** și selectează cursa alocată.
3. Apasă pe rând: **Am încărcat** → **Am plecat** → **Am livrat** (când e cazul).

`[SCREENSHOT: App Șofer — detaliu cursă cu butonul principal de status — evidențiază butonul Am încărcat]`

Pe aceeași cursă poți completa **CMR digital** și trimite **poze pe lot** (aviz/cântar). Detalii: [Ghid șofer](user-guides/driver-guide.md).

### 7. Închide bucla pe birou

De ce: fără confirmare și documente, cursa e „livrată pe teren”, dar biroul nu poate factura liniștit.

1. Revino pe contul de birou.
2. Deschide **Curse** → detaliul cursei.
3. Verifică statusul și, dacă există, CMR-ul digital sau scanul.
4. Generează / copiază **linkul de confirmare client** când e nevoie ca destinatarul să confirme recepția.

`[SCREENSHOT: detaliu cursă — secțiunea confirmare client / link — evidențiază butonul de generare sau copiere link]`

## Ce urmează

- Fluxuri zilnice: [Ghid dispecer](user-guides/dispatcher-guide.md)
- Documente și Anexa: [Rapoarte și avize](features/reporting.md)
- Probleme la login sau alocare: [Depanare](troubleshooting.md)
