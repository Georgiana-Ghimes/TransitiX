# 09. Tracking GPS

## Ce face

Arată unde sunt camioanele și compară **traseul planificat** cu **traseul realizat**.

## Ce vezi

- Poziția fiecărui vehicul, cu **viteză**, **direcție** și **kilometraj**.
- **Sursa** poziției — aplicația șoferului, un furnizor de telematică, sau sursa demonstrativă.
  E afișată ca să nu confunzi o simulare cu realitatea.
- **Opriri** — unde a stat vehiculul.
- **Reluare** (replay) — parcurgerea traseului unei zile, pas cu pas.

### Planificat vs Realizat (GPS)

Cele două trasee suprapuse, cu **diferența** între ele.

Aici se vede concret ce a costat abaterea de la plan: ocoluri, opriri neplanificate, ordine
schimbată în teren.

## Ce urmărim

- **Diferență mică între planificat și realizat.** Kilometrii în plus sunt combustibil și ore
  care n-au fost cerute de nimeni.
- **Opriri neplanificate puține și explicabile.**
- **Sosiri la timp** — indicatorul care alimentează Punctualitatea din Dashboard.
- **Fără goluri în urmărire** pe o cursă activă. Un gol lung înseamnă telefon închis sau semnal
  pierdut, și lasă cursa fără dovadă de traseu.

## Ce poate merge prost

- **„Nicio poziție încă"** — șoferul n-a pornit cursa în aplicație, sau telefonul n-are permisiune
  de locație.
- **„Nicio rută cu vehicul"** — nu există rută planificată pentru vehiculul selectat în ziua aleasă.
- **Traseu realizat gol dar cursa e livrată** — cursa a fost marcată din birou, nu din teren.

> **Notă privind datele:** pozițiile GPS istorice se păstrează **90 de zile**, apoi se șterg
> automat. Ultima poziție cunoscută a fiecărui vehicul **nu se șterge niciodată**, deci harta
> rămâne completă. Kilometrii realizați rămân pe cursă permanent — se șterge firul de urmărire,
> nu rezultatul.
