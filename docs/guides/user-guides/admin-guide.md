# Ghid administrator

## Cuprins

1. [Pentru cine e acest ghid](#pentru-cine-e-acest-ghid)
2. [Cum să… (index rapid)](#cum-să--index-rapid)
3. [Cum invit un utilizator nou](#cum-invit-un-utilizator-nou)
4. [Cum schimb rolul sau dezactivez un cont](#cum-schimb-rolul-sau-dezactivez-un-cont)
5. [Cum configurez datele firmei](#cum-configurez-datele-firmei)
6. [Cum setez tarifele și zonele](#cum-setez-tarifele-și-zonele)
7. [Cum citesc jurnalul de modificări](#cum-citesc-jurnalul-de-modificări)
8. [Ce pot face și celelalte roluri de birou](#ce-pot-face-și-celelalte-roluri-de-birou)

---

## Pentru cine e acest ghid

Pentru rolul **admin**. Tu răspunzi de conturi, de datele firmei și de urma modificărilor.

Operațiunile zilnice (dispecerat, avize) sunt în [Ghid dispecer](dispatcher-guide.md).

## Cum să… (index rapid)

- [Cum adaug un dispecer sau un șofer?](#cum-invit-un-utilizator-nou)
- [Cum opresc accesul cuiva?](#cum-schimb-rolul-sau-dezactivez-un-cont)
- [Cum actualizez CUI / adresa firmei?](#cum-configurez-datele-firmei)
- [Cum definesc tariful pe clasă de vehicul?](#cum-setez-tarifele-și-zonele)
- [Cum văd cine a schimbat o cursă?](#cum-citesc-jurnalul-de-modificări)

---

## Cum invit un utilizator nou

**De ce:** nu setezi tu parola colegului — el o alege din linkul de invitație (mai sigur).

1. Deschide **Utilizatori** (vizibil doar admin).
2. Inițiază o invitație nouă.
3. Completează emailul și **rolul** (`dispatcher`, `finance`, `driver`, `admin`).
4. Trimite / generează invitația.
5. Trimite linkul persoanei (emailul din aplicație poate fi în mod stub pe unele medii — verifică dacă ai primit confirmarea de trimitere).
6. Cere-i să seteze parola din link.
7. Verifică în listă că utilizatorul e activ.

`[SCREENSHOT: ecran Utilizatori — evidențiază formularul de invitație și coloana Rol]`

Pentru șoferi: după cont, leagă profilul din **Șoferi** de user-ul respectiv, ca App Șofer să vadă cursele alocate.

---

## Cum schimb rolul sau dezactivez un cont

**De ce:** un om care a plecat din firmă nu trebuie să mai vadă datele clienților.

1. Deschide **Utilizatori**.
2. Găsește contul.
3. Schimbă rolul dacă responsabilitățile s-au mutat.
4. **Dezactivează** contul dacă accesul trebuie tăiat.
5. Opțional: din **Setări**, închide sesiunile active („Închide toate”) dacă bănuiești o sesiune rămasă deschisă.

`[SCREENSHOT: listă utilizatori — evidențiază acțiunile de rol și activ/inactiv]`

---

## Cum configurez datele firmei

**De ce:** CMR-ul digital și facturile preiau denumirea, adresa și CUI-ul firmei.

1. Deschide **Setări** (din meniul profilului).
2. Completează numele firmei, CUI, adresă, contact.
3. Setează TVA / monedă dacă apar pe ecran.
4. Configurează pragurile de alertă pentru documente care expiră.
5. Salvează. **Salvarea setărilor de firmă e rezervată adminului.**

`[SCREENSHOT: Setări — formular firmă — evidențiază CUI și butonul Salvează]`

Detalii: [Setări](../features/settings.md).

---

## Cum setez tarifele și zonele

**De ce:** fără tarif valabil la data cursei, TPO-ul iese gol sau greșit — iar **Verificări date** va semnala eroarea.

1. Deschide **Config. comercială**.
2. Adaugă un **tarif** pe clasă de vehicul, cu `valid_from` / `valid_to` (nu edita „pe loc” istoricul — tarifele sunt pe perioade).
3. Configurează **zonele** și taxele pe **MMA** (nu pe clasă).
4. Completează **garajul** folosit la km tur-retur.
5. Adaugă coduri de observații dacă le folosiți pe avize.
6. Salvează fiecare secțiune conform ecranului.

`[SCREENSHOT: Config. comercială — tab tarife — evidențiază perioada de valabilitate]`

Vezi și: [Flotă, șoferi și tarife](../features/carrier-management.md).

---

## Cum citesc jurnalul de modificări

**De ce:** la o dispută („cine a schimbat greutatea?”) jurnalul arată urma pe zile.

1. Deschide **Jurnal modificări** (doar admin).
2. Alege ziua sau filtrele disponibile.
3. Deschide o înregistrare pentru a vedea ce câmpuri s-au schimbat.
4. Corelează cu utilizatorul din listă.

`[SCREENSHOT: Jurnal modificări — o înregistrare cu diff pe câmpuri — evidențiază userul și timestamp-ul]`

---

## Ce pot face și celelalte roluri de birou

| Capacitate | admin | dispatcher | finance |
|------------|:-----:|:----------:|:-------:|
| Dispecerat, curse, avize, GPS | da | da | da |
| Config. comercială (UI) | da | da | da |
| Salvare Setări firmă | da | nu | nu |
| Utilizatori | da | nu | nu |
| Jurnal modificări | da | nu | nu |

Controalele fine pe API pot diferi; în interfață, diferența vizibilă e pe cele două iteme de meniu admin + salvarea setărilor.

`[TODO: verify with development team]` — lista exactă a restricțiilor pe endpoint-uri pe mediul de producție.

---

## Vezi și

- [Ghid dispecer](dispatcher-guide.md)
- [Setări](../features/settings.md)
- [Depanare](../troubleshooting.md)
