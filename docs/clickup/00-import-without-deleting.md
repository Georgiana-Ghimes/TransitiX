# Import ClickUp — două pagini (română)

ClickUp **nu șterge** paginile vechi la Import. **Archive** / **Delete** le-ar șterge — nu le folosi.

Importul HTML „cu page splitting” a lipit totul pe o pagină în engleză. Varianta corectă pentru wiki-ul vostru: **câte un fișier pe pagină, un singur H1, în română**.

## Ce înlocuiește ce

Ai deja în ClickUp:

- **Spec MVP - Transitix V2**
- **Avize - Stare curent si development plan**

Conținutul de reimportat (repo):

| Pagină ClickUp (păstrează numele) | Fișier |
| --- | --- |
| Spec MVP - Transitix V2 | `docs/clickup/spec-mvp-v2-ro.md` sau `spec-mvp-v2-ro.html` |
| Avize - Stare curentă și plan de dezvoltare | `docs/clickup/avize-stare-si-plan-ro.md` sau `avize-stare-si-plan-ro.html` |

Poți redenumi a doua pagină în **Avize - Stare curentă și plan de dezvoltare** (diacritice + „dezvoltare”).

## Cum importi fără să strici restul wiki-ului

**Varianta A — Markdown (recomandat)**

1. Deschide pagina **Spec MVP - Transitix V2** (nu o pagină veche).
2. Șterge corpul vechi (engleză lipită), lasă titlul paginii.
3. Import → **Markdown** → `spec-mvp-v2-ro.md`.  
   Sau copiază tot markdown-ul în pagină.
4. Repetă pe pagina Avize cu `avize-stare-si-plan-ro.md`.

**Varianta B — HTML, fără page splitting**

1. Aceeași pagină țintă.
2. Import → **HTML** (nu „HTML with page splitting”).
3. Alege `spec-mvp-v2-ro.html` respectiv `avize-stare-si-plan-ro.html`.

Nu importa `transitix-clickup-import.html` (are 6× H1, e pachetul vechi).

## Pagini care rămân nemodificate

competitors solutions · Spec MVP - Transitix (2024) · B44 - Prompt · Credentiale · VM Steps
