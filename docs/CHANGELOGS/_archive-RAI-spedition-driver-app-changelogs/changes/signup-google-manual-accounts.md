# Înregistrare clienți noi, Google, conturi manuale

Branch `RAI-spedition-driver-app` · 17 septembrie 2026

## Ce s-a schimbat

### Înregistrare (`/register`, ambele profiluri)
- Alegere **Email de firmă** / **Email personal** + buton propriu **Autentifică-te cu Google** / **Înregistrează-te cu Google** (butonul oficial Google e suprapus transparent; în dev apare și neconfigurat, cu indicație).
- Avertismente live: adresă personală declarată ca firmă (blochează), adresă de firmă declarată
  personală (atenționează), adresă deja folosită (blochează, cu link spre login/reset), domeniu
  deja folosit de alte conturi (`DOMAIN_IN_USE`, cere bifă de confirmare).
- Contul nu mai primește sesiune la înregistrare: se trimite **email de confirmare** (Resend,
  link 48 h, token stocat doar ca hash). Login-ul unui cont neconfirmat → `403 EMAIL_NOT_VERIFIED`
  și ecran cu „Retrimite linkul” (cooldown 60 s). Fără Resend, linkul apare pe ecran.
- `ALLOW_SIGNUP=false` oprește înregistrarea (inclusiv prin Google); pagina spune să ceri invitație.

### Google
- `POST /api/auth/google` verifică ID token-ul pe server (certificate Google, `aud`, emitent,
  expirare, `email_verified`). Fără `GOOGLE_CLIENT_ID` butonul nu apare.
- Adresă existentă → autentificare (și revendică o invitație în așteptare). Adresă nouă →
  `404 GOOGLE_NEEDS_COMPANY` → ecranul cere numele firmei.

### Setări › Utilizatori
- **Adaugă manual**: parolă temporară (tastată sau generată, afișată o dată),
  `must_change_password`; token-ul poartă `pcr`, serverul refuză tot în afară de `/api/auth/`
  până la `POST /api/auth/change-password`; ecran nou `/change-password`.
- Stare nouă **Creat manual**, avertisment „parolă temporară”, eticheta „Google” pe rând.
- Avertismente la invitare: adresă personală, domeniu diferit de al firmei, email neconfigurat.
- Invitația verifică adresa în **toate** firmele (înainte doar în firma curentă).
- Emailul de invitație conține numele firmei și un buton.

### Securitate / reparații
- Linkurile din emailuri (reset, invitație, confirmare) folosesc `CLIENT_ORIGIN`; `origin` trimis
  de browser e acceptat doar dacă e pe listă (înainte: oricare → token livrat pe alt host).
- Numele din emailuri sunt escapate HTML.
- `/auth/register` nu mai accepta orice parolă (nu avea verificare de lungime).
- Politică parolă: minimum **10** caractere (era 6), fără spații la capete, fără adresa de email
  în parolă. Oglindită în `src/lib/emailKind.js`.
- Resetarea parolei închide toate sesiunile și confirmă adresa.
- Rate limit separat per rută de autentificare; limită pe emailuri trimise (10/oră/IP).
- `/reset-password` tradus în română; servește și pentru acceptarea invitației.

## Schemă
`users`: `created_via`, `email_verified_at`, `email_verify_token_hash`, `email_verify_expires_at`,
`google_sub` (unic parțial), `must_change_password`. Backfill verificat doar pentru
`created_via IS NULL` (conturile existente).

## Variabile noi
`ALLOW_SIGNUP` (implicit `true`), `GOOGLE_CLIENT_ID`. `RESEND_API_KEY` + `EMAIL_FROM` acoperă acum
și invitațiile / confirmările.

## Teste
- Unit: `server/src/lib/auth/{signup,google,mail}.test.js`, `src/lib/emailKind.test.js`,
  extinderi în `rules.test.js`, `middleware/auth.test.js`, `usersUi.test.js`.
- Rute: `server/src/routes/signup.api.test.js` (29 teste; Google mock-uit).
- Eșec preexistent, neatins: `audit.api.test.js › includes the last day of a date range`
  (pică identic fără aceste modificări; pare legat de fusul orar după miezul nopții).

## Rămas deschis
- Blocklist-ul de parole descris în manual există pe `main` (`lib/password.js`), nu pe acest branch.
- Pentru Google: client OAuth „Web application” în Google Cloud, cu originea aplicației la
  „Authorized JavaScript origins”.
- Pentru Resend: domeniu verificat, `EMAIL_FROM` pe acel domeniu.
