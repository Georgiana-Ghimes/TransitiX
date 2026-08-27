# Sprint 4 — 27 august 2026

Sprintul de infrastructură: lucrurile care nu se văd în ecran, dar decid dacă sistemul poate fi
operat de altcineva decât cine l-a scris. Fiecare schimbare are versiune proprie, vizibilă în
aplicație jos-stânga.

## CHANGELOG

### Migrări cu versiune și rollback — v1.13.0

`migrate.js` era un singur șablon SQL de 1400 de linii care rula integral de fiecare dată.
Funcționa, fiindcă fiecare instrucțiune din el e idempotentă (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`), dar nu putea răspunde la trei întrebări: ce s-a aplicat pe baza
asta, ce lipsește și cum anulez ultima schimbare. Iar idempotența e o convenție pe care n-o
impune nimic — primul `ALTER TABLE … DROP COLUMN` scris de cineva ar rula la fiecare deploy,
pentru totdeauna.

- **Compromis intenționat.** Rescrierea acelui fișier în cincizeci de pași numerotați ar fi o
  schimbare mare care nu modifică nimic din schema rezultată, iar tot riscul stă în rescriere.
  Așa că monolitul rămâne ca **schemă de bază**, înregistrat o dată ca `0000_baseline`, și tot
  ce urmează e un fișier numerotat care rulează exact o dată.
- **Tabelă `schema_migrations`** cu id, durată și **SQL-ul de rollback stocat odată cu pasul** —
  un `.down.sql` din repo descrie ce spune fișierul azi; înregistrarea descrie ce a rulat atunci.
- **Fiecare migrare are propria tranzacție.** Un eșec la pasul cinci lasă primii patru
  înregistrați, nu anulați în tăcere într-o stare cu care jurnalul nu e de acord.
- **Un fișier cu nume greșit e eroare, nu ceva sărit.** O migrare ignorată din cauza unei greșeli
  de tipar e cel mai prost rezultat posibil. La fel două migrări cu același număr: ordinea ar
  depinde de sistemul de fișiere.
- **`npm run db:migrate:status`** arată ce a rulat și ce nu, plus ce nu are rollback.
  **`npm run db:migrate:down`** anulează ultimul pas — și **refuză** dacă acesta n-are `.down.sql`,
  în loc să ghicească ce a vrut autorul. Unele schimbări chiar nu se pot anula.
- **Migrările aplicate care nu mai există în repo** (de obicei o schimbare de ramură) sunt
  raportate, nu reparate: ștergerea înregistrării ar pierde rollback-ul stocat cu ea.
- **Prima migrare reală: `0001_users_invited_by`** — cine pe cine a invitat, cu `ON DELETE SET
  NULL` ca plecarea celui care a invitat să nu ia cu ea conturile create de el.
- **Ciclul complet verificat pe bază reală**: aplicare → status → re-rulare fără efect → rollback
  (coloana chiar dispare) → re-aplicare. **17 teste unitare.**

### Logare structurată — v1.14.0

Erau 182 de apeluri `console.*`, majoritatea `console.error(err)` fără nicio indicație despre
cererea din care veneau. În development e citibil, fiindcă se întâmplă un singur lucru odată. În
producție, cu mai multe cereri în paralel, un stack trace fără cerere în spate spune că ceva s-a
stricat și nimic despre pentru cine, pe datele cărei firme, sau după ce.

- **Două formate, fiindcă cititorii sunt doi**: `pretty` pentru un om care se uită la terminal,
  `json` pentru un colector care indexează. Implicit după `NODE_ENV`, forțabil din `LOG_FORMAT`.
- **Corelare cu cererea prin `AsyncLocalStorage`.** Un logger la nivel de modul, trei fișiere mai
  jos de rută, n-are acces la `req` — și exact aceea e linia care ar fi rămas fără context. Restul
  cererii rulează în store, iar orice logger citește din el. Zero modificări la punctul de apel.
- **Fiecare cerere are un id**, întors în `X-Request-Id` și pus pe toate liniile ei. „O eroare pe
  la 14:32" devine ceva ce se poate căuta.
- **O linie pe cerere, la final**, nu una la intrare și una la ieșire — cu status și durată. Nivelul
  crește singur: 4xx → warn, 5xx → error, iar un răspuns de peste 2 secunde e warn chiar dacă a
  reușit.
- **Health check-urile și fișierele statice nu se loghează.** Un jurnal care e în majoritate zgomot
  nu mai e citit, ceea ce e totuna cu a nu-l avea.
- **Nimic sensibil nu ajunge acolo**, filtrat după tipar (`pass`, `token`, `secret`,
  `authorization`, `cookie`, `key`), nu după o listă de nume. Se loghează **cine**, niciodată **ce
  a trimis** — corpul cererii e locul unde stau parolele.
- **Scripturile CLI păstrează `console` intenționat.** `seed`, `backfill-locations`,
  `geocode-locations`, `migrate` vorbesc cu un om la terminal; linii JSON acolo ar fi mai rău,
  nu mai bine.
- **182 → 0** apeluri `console.*` în codul de server care servește cereri. **33 teste unitare.**

### Antete de securitate și o politică de parole reală — v1.15.0

- **`helmet`**, cu două excepții motivate în cod: fără CSP (procesul ăsta servește un API și
  fișiere încărcate, nu HTML-ul aplicației — un CSP aici n-ar apăra nimic și s-ar citi drept
  protecție care există), și `crossOriginResourcePolicy: same-site` ca browserul să încarce în
  continuare o scanare CMR de pe originea API-ului.
- **HSTS doar în producție.** Helmet îl trimite implicit, ceea ce înseamnă că browserul unui
  dezvoltator e instruit să fixeze `localhost` pe https un an. Browserele îl ignoră peste HTTP
  simplu, deci nu strica nimic azi — dar un antet trimis unde nu se poate aplica e un antet despre
  care nimeni nu poate raționa. Verificat în ambele moduri.
- **Politica de parole avea două valori diferite**: `reset-password` cerea șase caractere, iar
  `register` **nu cerea nimic** — o firmă se putea crea cu o parolă de un caracter.
- **Regula nouă: lungime plus listă de interziceri, fără reguli de compoziție.** Obligativitatea
  unei majuscule, a unei cifre și a unui simbol e exact ce produce `Parola1!` pe toate conturile
  firmei — măsoară conformarea cu o regulă, nu rezistența la ghicit. Minimul e 10 caractere, iar
  o frază lungă fără simboluri trece.
- **Parola nu poate fi propriul email sau propriul nume.** E lungă, nu e pe nicio listă, și e
  primul lucru pe care l-ar încerca oricine.
- **Regula se vede înainte de a fi încălcată** — pe ecranul de înregistrare și pe cel de resetare,
  plus `GET /api/auth/password-policy`. O regulă descoperită doar prin eșec pare arbitrară.
- **Client și server nu pot să divergă**: un test importă ambele module și compară minimul și
  textul, la fel ca la prefixul UIT. Verificarea din browser rămâne cea ieftină; lista de
  interziceri stă pe server, unde nu poate fi sărită.
- **25 teste unitare pe politică + 9 pe acordul client–server + 7 de rută** (antete, politică,
  refuzuri).

### Durata token-ului de acces: 24h → 30m — v1.15.2

- **`authRequired` verifică doar semnătura**, nu baza de date. Asta înseamnă că dezactivarea unui
  cont sau schimbarea unui rol încheie sesiunile imediat — deci contul nu se mai poate reînnoi —
  dar un token deja emis rămâne valabil până expiră. Durata lui *este* fereastra. O zi era prea
  mult pentru ceva ce ecranul de utilizatori prezintă ca o acțiune de securitate.
- **Nu se vede la utilizatori.** Clientul reîmprospătează transparent la 401 și reia cererea o
  dată, inclusiv pentru descărcările binare și pentru coada offline a aplicației de șofer (ale
  cărei acțiuni trec tot prin `api.*`). Token-ul de refresh rămâne la 7 zile, deci nimeni nu se
  reautentifică mai des.
- **Coada offline parchează pe 401 doar dacă și refresh-ul a eșuat** — adică token-ul de refresh
  e mort. În cazul acela parcarea e corectă: șoferul chiar trebuie să se autentifice din nou.
- Verificat: serverul emite acum token-uri de 30 de minute și refresh de 7 zile.

### Documentație și unelte — v1.15.1

- **Harta de produs din README era veche**: lipseau Rapoarte, Verificări date, Configurare
  comercială, Utilizatori, Jurnal modificări, Încărcare, Plan 2D și Teritorii; „Tracking GPS" încă
  scria „hartă demo".
- **README-ul presupunea Docker.** Acum spune și varianta cu un Postgres pornit nativ, fiindcă așa
  rulează efectiv mașina de development.
- **Secțiuni noi**: cum se rulează testele de rută și de ce au nevoie de o bază `*_test`, cum se
  scriu migrările, și ce înseamnă liniile din jurnal.
- **`engines` fixat** în ambele `package.json`: Node >= 20.11, npm >= 10. Un prag, nu un plafon.
- **`npm run version:bump`** — `major`/`minor`/`patch` sau o versiune explicită, scrisă în ambele
  fișiere deodată. Hook-ul de post-commit făcea deja asta din mesajul de commit, dar rulează doar
  la commit; munca terminată și verificată înainte de commit trebuie să arate versiunea corectă,
  fiindcă bara laterală citește direct din `package.json`.

### Manual de utilizare — v1.15.3

Documentația existentă era pentru cine rulează proiectul. Nu exista nimic pentru cine îl
folosește — un dispecer nou învăța ecranele întrebând pe cineva.

- **24 de capitole în `docs/manual/`**, în română, legate dintr-un cuprins.
- **Fiecare capitol răspunde la aceleași patru întrebări**: ce face ecranul, cum lucrezi în el,
  **ce rezultat urmărim**, și ce poate merge prost. A treia e cea care lipsește de obicei din
  manuale: un ecran descris fără rezultatul lui e o listă de butoane.
- **Un capitol de concepte** (cursă, aviz, TPO, CMR, tarif, clasă vs MMA, kilometri facturabili)
  și fluxul complet de la comandă la factură. Restul manualului îl presupune citit.
- **Un capitol cu toți indicatorii adunați**, cu ținta fiecăruia și ecranul de unde se citește,
  plus ordinea în care merită atacați când totul e roșu deodată.
- **Un capitol de probleme frecvente**, inclusiv un tabel „lucruri care par defecte și nu sunt":
  `STUB-` pe codul UIT, „Punctualitate —" când nu există sosiri reale, o celulă goală în loc de
  zero, un CMR tipărit vizibil nesemnat.
- **Onestitate despre ce e simulat.** Fiecare integrare are starea ei reală scrisă: e-Factura și
  e-Transport sunt simulări, rutarea e oprită la voi, iar manualul o spune în locul în care omul
  ar observa lipsa.
- Verificat automat: toate legăturile interne se rezolvă, niciun fișier orfan, fără diacritice
  stricate.

## BUGFIX

- **Logger-ul tăia stack trace-urile.** Limita de 300 de caractere pentru valori se aplica și
  câmpului `stack`, deci cea mai utilă linie din jurnal ajungea `«1044 caractere»`. Prins de
  propriul test înainte de a ajunge undeva.
- **`register` accepta orice parolă**, inclusiv de un caracter — nu exista nicio verificare, nici
  măcar cea de șase caractere din resetare.
- **Verificarea din browser la înregistrare cerea 6 caractere** iar serverul acum cere 10: fără
  constanta comună, formularul ar fi lăsat să treacă exact ce API-ul respinge.
- **HSTS pleca și în development** — vezi mai sus; comentariul din cod spunea că e limitat la
  producție, dar codul nu făcea asta.

## NOTE

- **`OSRM_URL` rămâne nesetat**, la cererea explicită a utilizatorului. Cât timp e așa, `/api/geo/*`
  răspunde 503 în loc de o distanță inventată, iar TPO-ul n-are componenta de kilometri.
- **`JWT_EXPIRES_IN` a fost coborât de la 24h la 30m** (vezi mai sus). Fereastra în care un cont
  dezactivat mai poate lucra e acum o jumătate de oră, nu o zi.
