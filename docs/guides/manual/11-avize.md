# 11. Avize și OCR

## Ce face

Transformă **teancul de avize scanate** într-un tabel pe care îl poți verifica, corecta și trimite
mai departe. E puntea dintre hârtia care vine de la client și cifrele care ajung pe factură.

## Fluxul

```
Încarci scanările (PDF sau poze)
      ↓
OCR-ul citește câmpurile automat        → status „Extras"
      ↓
Un om verifică și corectează            → status „Confirmat"
      ↓
Avizul se leagă de o cursă
      ↓
Intră în rapoarte și în factură
```

### Cele trei stări

| Stare | Ce înseamnă |
|-------|-------------|
| **Încărcat** | Fișierul e în sistem, nu s-a citit încă |
| **Extras** | OCR-ul a citit ce a putut. **Nu e bun de folosit până nu-l confirmă un om.** |
| **Confirmat** | Un om a verificat. De acum contează. |

## Cum lucrezi

### Tabelul de revizie

Fiecare rând e un aviz, fiecare coloană un câmp citit. Pe fiecare câmp vezi **cât de sigur e
OCR-ul**. Câmpurile nesigure sunt evidențiate — acolo te uiți întâi.

Lista e **paginată**: alegi câte rânduri vezi (20 / 50 / 100 / 500). Selecția pentru Anexa XLSX
sau ștergere rămâne și pe paginile următoare, până schimbi filtrele.

**Când corectezi un câmp, corectura rămâne definitivă.** O re-extragere ulterioară nu o suprascrie:
ce a spus omul bate ce a citit mașina, oricând.

### Coloane și șabloane

Poți adăuga, șterge și reordona coloane, apoi salva aranjamentul ca **șablon** (ex. „Șablon Anexa
Factură"). Un șablon poate fi marcat **Default**, ca să se deschidă singur.

### Legarea de cursă

Un aviz confirmat trebuie legat de o cursă. Nelegat, nu ajunge nicăieri — și
[Verificări date](13-verificari.md) îl semnalează.

### Ștergerea (unul sau mai multe)

Pe fiecare rând există **Șterge**. Dacă bifezi mai multe avize, apare și **Șterge selectate** —
aceeași selecție pe care o folosești la Anexa XLSX. Confirmarea e obligatorie; după ștergere
selecția se golește. **Nu se poate anula** — folosește-o pentru dubluri, teste sau încărcări greșite.

### Trimiterea

Din avize poți genera **Anexa Factură** (XLSX) și o poți trimite pe email direct din ecran.

**Ce trimiți se salvează exact așa cum a plecat.** Peste luni poți re-descărca aceeași foaie, cu
aceleași cifre, chiar dacă între timp avizele s-au corectat. Istoricul exporturilor e în
[12. Rapoarte](12-rapoarte.md).

## Ce urmărim

- **Timp de la scanare la confirmare** cât mai scurt. Un aviz neconfirmat blochează o factură.
- **Zero avize confirmate fără greutate brută.** Fără ea, raportul nu poate fi confruntat cu bonul
  de cântar.
- **Zero avize confirmate nelegate de cursă.**
- **Zero TPO-uri duplicate** — același număr pe două documente face anexa nereconciliabilă.
- **Rata de corectură manuală în scădere.** Dacă tot corectezi aceleași câmpuri, layout-ul acelui
  client are nevoie de un profil OCR mai bun.

## Ce poate merge prost

| Simptom | Ce s-a întâmplat |
|---------|------------------|
| Câmpuri goale după OCR | Scanare de proastă calitate, sau layout nou. Completează manual — corectura se reține. |
| Documentul nu iese din „Extras" | Un câmp obligatoriu e încă necompletat. |
| Același TPO pe două avize | Unul e greșit. Verificările îl semnalează înainte de factură. |
| Datele arată decalate cu o zi | Semnalează — a fost o problemă cunoscută de fus orar, rezolvată; dacă reapare, e altceva. |

> **Se păstrează permanent:** fișierele avizelor, istoricul exporturilor cu conținutul lor, și
> jurnalul corecturilor OCR. Nimic din acestea nu se șterge automat.
