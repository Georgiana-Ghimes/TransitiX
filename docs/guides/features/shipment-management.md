# Gestionarea curselor și a CMR-ului

## Cuprins

1. [Cum să… (index)](#cum-să--index)
2. [Ce este o cursă](#ce-este-o-cursă)
3. [Cum creez o cursă](#cum-creez-o-cursă)
4. [Cum editez sau anulez](#cum-editez-sau-anulez)
5. [Statusuri](#statusuri)
6. [CMR digital vs scan](#cmr-digital-vs-scan)
7. [Link de confirmare client](#link-de-confirmare-client)
8. [Legătura cu Dispeceratul](#legătura-cu-dispeceratul)

---

## Cum să… (index)

- [Cum creez o cursă nouă?](#cum-creez-o-cursă)
- [Cum schimb statusul?](#statusuri)
- [Cum completez CMR digital pe birou?](#cmr-digital-vs-scan)
- [Cum trimit linkul clientului?](#link-de-confirmare-client)

---

## Ce este o cursă

O **cursă** este misiunea de transport: cine trimite, cine primește, ce marfă, cine conduce, ce status are.

Pe birou o găsești în **Curse**. Șoferul o vede în App Șofer doar dacă e **alocat** pe ea.

## Cum creez o cursă

**De ce:** fără cursă nu ai pe ce agăța CMR-ul, avizele și confirmarea clientului.

1. Deschide **Curse**.
2. Apasă acțiunea de creare.
3. Completează expeditorul și destinatarul (nume, adresă, telefon dacă le ai).
4. Setează datele de încărcare / livrare.
5. Adaugă descrierea mărfii, greutatea, coletele — dacă le știi deja.
6. Alocă șoferul și vehiculul când sunt clari.
7. Salvează.

`[SCREENSHOT: formular cursă — evidențiază blocurile expeditor, destinatar și alocare]`

Poți exporta lista în CSV din ecranul de listă, dacă butonul e disponibil.

## Cum editez sau anulez

**De ce:** o adresă greșită pe cursă se propagă în CMR și la șofer.

1. Deschide cursa din listă.
2. Editează câmpurile greșite.
3. Salvează.
4. Pentru anulare, setează statusul **Anulată** (sau folosește acțiunea de anulare din UI, dacă există).

**Atenție:** dacă ai calculat deja un TPO și apoi schimbi cursa, **Verificări date** poate semnala TPO învechit.

## Statusuri

| Status UI | Semnificație scurtă |
|-----------|---------------------|
| De planificat | Încă nu e alocată / gata de execuție |
| Alocată | Are șofer (și de obicei vehicul); șoferul o poate vedea |
| Încărcată | Marfa e în camion |
| În tranzit | Pe drum |
| Livrată | Predată |
| Problemă | Incident pe cursă |
| Anulată | Nu se mai execută |

În App Șofer, butoanele avansează tipic: Alocată → Încărcată → În tranzit → Livrată.

`[SCREENSHOT: listă Curse cu mai multe badge-uri de status — evidențiază legenda vizuală]`

## CMR digital vs scan

**De ce:** o singură notă de transport pe cursă. Două variante = litigiu.

### Variantă digitală

1. Deschide detaliul cursei.
2. Completează CMR digital (sau lasă șoferul să o facă pe telefon — același document).
3. Salvează ciorna.
4. Semnează etapa de încărcare, apoi pe cea de livrare.

La semnarea încărcării, greutatea / coletele / natura se copiază pe cursă.

### Variantă scan

1. Încarcă poza / PDF-ul CMR pe detaliul cursei (secțiunea de scan).
2. Rulează OCR dacă e oferit.
3. Confirmă datele pe birou.

După un scan pe cursă, **formularul digital se închide**.

`[SCREENSHOT: detaliu cursă — CMR digital și opțiunea de scan hârtie — evidențiază cele două căi]`

## Link de confirmare client

**De ce:** destinatarul confirmă recepția fără să aibă cont în TMS.

1. Pe detaliul cursei, deschide secțiunea de confirmare client.
2. Generează linkul (sau reîmprospătează-l).
3. Copiază linkul sau trimite-l pe email (trimiterea depinde de configurarea emailului pe server).
4. Clientul deschide `/confirm/…` și confirmă — vezi [Ghid client](../user-guides/customer-guide.md).

`[SCREENSHOT: secțiune confirmare client pe detaliu cursă — evidențiază copierea linkului]`

## Legătura cu Dispeceratul și cu planul de încărcare

- **Curse** = documentul / misiunea (CMR, status, facturare).
- **Dispecerat** = planul pe zi (rute, opriri, lansare, UIT).
- **Încărcare** = cum se umple camionul pe o **rută deja alocată** (vedere laterală, compartimente).
- **Plan 2D** = aranjezi tu marfa pe **desenul** camionului (tragere sau butonul Plasează 1).

Pași lenți pentru încărcare și Plan 2D: [Ghid dispecer](../user-guides/dispatcher-guide.md#cum-văd-planul-de-încărcare-pe-o-rută-reală).

---

## Vezi și

- [Ghid dispecer](../user-guides/dispatcher-guide.md)
- [Ghid șofer](../user-guides/driver-guide.md)
- [Glosar — CMR](../glossary.md#cmr)
- [Glosar — Plan 2D](../glossary.md#plan-2d--planificator-2d-încărcare)
- [Glosar — Încărcare](../glossary.md#încărcare-plan-pe-rută)
