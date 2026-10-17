# Update & deploy · RAI PROD

> **Copy-paste ready** pentru Confluence / ClickUp  
> Folosește-l **la fiecare** urcare de versiune · Document: **12 octombrie 2026**

| | |
|---|---|
| **Site** | https://rai-transitix.filumforge.ro |
| **SSH** | `ssh root@185.137.122.45` |
| **App pe VPS** | `/opt/rai/TransitiX` |
| **Branch test** | `MISTRAL-experimenting-rai-documents` |
| **Branch prod** | `TRANSITIX-RAI-PROD` |
| **Environment GitHub** | `RAI-PROD` |

**Tag-uri:** `ACELAȘI HASH pe ambele branch-uri` · `backup → migrate → build → restart` · `Fără cherry-pick pe ambele`

---

> ✅ **Regula de aur:** pe MISTRAL și pe `TRANSITIX-RAI-PROD` trebuie să fie **același commit SHA** după merge.  
> Nu face cherry-pick pe ambele — creează două hash-uri și „1 ahead / 1 behind”.

> ⛔ **Pe VPS nu folosi** `npm run dev:companion`.  
> Doar pull + `deploy-companion.js` + servicii (systemd / Caddy).

---

## Flux pe o privire

```
PC (MISTRAL, test)
        │  commit + push
        │  merge --ff-only → TRANSITIX-RAI-PROD
        │  push PROD
        ▼
GitHub  TRANSITIX-RAI-PROD  (același SHA ca MISTRAL)
        │
        ▼
VPS     git reset --hard origin/TRANSITIX-RAI-PROD
        deploy-companion.js  (backup → migrate → build → restart)
        │
        ▼
https://rai-transitix.filumforge.ro
```

---

## A. Pe PC — trimiți codul pe branch-ul de prod

### A1. Lucrezi și testezi

1. Branch: `MISTRAL-experimenting-rai-documents`
2. Faci modificările, testezi local (`dev:companion` pe PC).
3. Commit + push pe MISTRAL.

### A2. Urci pe PROD (același hash)

```bash
git checkout TRANSITIX-RAI-PROD
git fetch origin
git merge --ff-only MISTRAL-experimenting-rai-documents
git push origin TRANSITIX-RAI-PROD

# verificare: același SHA
git rev-parse HEAD
git rev-parse MISTRAL-experimenting-rai-documents

git checkout MISTRAL-experimenting-rai-documents
```

> ⚠️ Dacă `merge --ff-only` eșuează, branch-urile au divergat.  
> Nu forța pe prod până nu înțelegi de ce. Aliniază (merge corect sau reset controlat), apoi verifică din nou SHA-urile.

**Checklist PC**

- [ ] Test ok pe MISTRAL
- [ ] Merge FF pe `TRANSITIX-RAI-PROD`
- [ ] Push pe origin
- [ ] SHA MISTRAL = SHA PROD

---

## B. Pe VPS — o singură comandă

**Conectare:**

```bash
ssh root@185.137.122.45
```

**Deploy:**

```bash
cd /opt/rai/TransitiX
npm run deploy:companion:vps
```

Asta rulează, în ordine:

1. **git** — `fetch` + `checkout` + `reset --hard` pe `origin/TRANSITIX-RAI-PROD`  
   (= actualizează codul de pe GitHub; **nu** mai faci `git pull` separat — pe VPS `reset --hard` e mai sigur decât `pull`, fără merge local)
2. **npm ci** — root + `server/`
3. **deploy-companion** — backup → migrate → build → `systemctl restart rai-api`
4. **caddy reload** (best-effort)
5. **health** — `curl` pe `http://127.0.0.1:3002/api/health`

Citește `DATABASE_URL` din `server/.env.companion` și setează `COMPANION=1`.

> ℹ️ Dacă un pas eșuează, scriptul se oprește. Nu „jumătate deploy”.  
> Repari, rulezi din nou. Clientul rămâne pe versiunea veche până reușește tot lanțul.

> ⚠️ Dacă pe VPS încă **nu** există `deploy:companion:vps` (cod vechi), o dată:  
> `git fetch origin TRANSITIX-RAI-PROD && git reset --hard origin/TRANSITIX-RAI-PROD`  
> apoi `npm run deploy:companion:vps`. După build 100, doar comanda scurtă.

> ⚠️ **`vite: not found` la build:** `npm ci` a omis devDependencies (NODE_ENV=production).  
> Scriptul de deploy (build 101+) folosește `npm ci --include=dev`. Deblocare rapidă pe VPS:  
> `npm ci --include=dev && npm run deploy:companion:vps -- --skip-git --skip-npm-ci --skip-backup`

> ℹ️ **Health pe :3002:** e o verificare opțională după deploy. Dacă curl nu răspunde la timp, scriptul
> **nu** tratează asta ca „aplicația e stricată” — build+restart s-au terminat deja; vei vedea un mesaj
> clar + comenzi de verificat. Implicit exit 0 (avertisment). `--strict-health` = exit 1.

Opțiuni utile: `--skip-git`, `--skip-npm-ci`, `--skip-backup`, `--dry-run`  
(ex. `npm run deploy:companion:vps -- --dry-run`).

**Checklist după deploy**

- [ ] `curl` health: `"ok":true`, `"db":true`, `"ocr":"mistral"`
- [ ] Browser: https://rai-transitix.filumforge.ro (hard refresh `Ctrl+Shift+R` dacă UI vechi)
- [ ] Login + o acțiune scurtă (ex. listă avize)
- [ ] Versiunea / build-ul din UI corespunde cu ce ai pus pe PROD

---

## C. Rollback (dacă ceva e greșit)

### C1. Rollback cod (păstrezi baza)

```bash
cd /opt/rai/TransitiX
git log --oneline -15
# alegi COMMIT_BUN
git reset --hard COMMIT_BUN

# fără git pull (ești deja pe commit-ul bun); skip-backup dacă ai dump recent
npm run deploy:companion:vps -- --skip-git --skip-backup
```

Pe PC / GitHub: aliniază `TRANSITIX-RAI-PROD` (și MISTRAL, dacă e cazul) la **același** commit.

### C2. Rollback date

Restore din `/var/backups/rai/` (vezi ghidul de instalare, §12).  
Snapshot Contabo = doar dacă mașina e stricată, nu pentru o greșeală de cod.

---

## D. Comenzi utile pe VPS

```bash
# status
systemctl status rai-api caddy --no-pager
docker compose -f /opt/rai/TransitiX/docker-compose.companion.yml ps
journalctl -u rai-api -n 80 --no-pager

# health public
curl -sS https://rai-transitix.filumforge.ro/api/health | head -c 400; echo

# backup manual (între deploy-uri)
cd /opt/rai/TransitiX
export COMPANION=1
export DATABASE_URL="$(grep ^DATABASE_URL= server/.env.companion | cut -d= -f2-)"
npm run db:backup -- --out /var/backups/rai --keep 14
```

---

## E. Ce NU faci

- Nu lucra direct pe VPS în fișiere (apoi `git pull` se încurcă).
- Nu rula `dev:companion` pe VPS.
- Nu face cherry-pick pe MISTRAL *și* pe PROD separat.
- Nu deschide în firewall porturile 3002 / 5435 spre internet.
- Nu comita `.env.companion` / `.env.postgres`.

---

## F. Mai târziu — deploy automat (opțional)

Când vrei zero SSH la update: GitHub Actions pe push la `TRANSITIX-RAI-PROD`, environment **RAI-PROD**, pe VPS: `cd /opt/rai/TransitiX && npm run deploy:companion:vps`.

Până atunci, pașii **A + B** sunt sursa de adevăr.

Detalii workflow: vezi ghidul de instalare, [§13](./Ghid-deploy-RAI-PROD-VPS.md#13-update-la-push-github-actions).

---

## G. Fișiere / căi de reținut

| Ce | Unde |
|----|------|
| Cod | `/opt/rai/TransitiX` (branch `TRANSITIX-RAI-PROD`) |
| UI build | `/opt/rai/TransitiX/dist` |
| Secrete | `/opt/rai/TransitiX/server/.env.companion` |
| Parolă Postgres | `/opt/rai/TransitiX/.env.postgres` |
| Uploads | `/opt/rai/TransitiX/server/uploads-companion` |
| Backup-uri | `/var/backups/rai/` |
| API serviciu | `rai-api.service` |
| HTTPS | `/etc/caddy/Caddyfile` |
| Ghid instalare inițială | `docs/VPS/Ghid-deploy-RAI-PROD-VPS.md` |

---

## H. Checklist pe o foaie

- [ ] MISTRAL: commit + push, test ok
- [ ] PROD: `merge --ff-only` + push (același SHA)
- [ ] VPS: `npm run deploy:companion:vps`
- [ ] Health + browser OK
- [ ] Snapshot Contabo doar după schimbări mari

---

*Ghid update/deploy RAI PROD · rai-transitix.filumforge.ro · VPS Contabo · docs/VPS · local (gitignored)*
