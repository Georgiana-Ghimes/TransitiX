# RAI Spedition · companion documente (profil izolat)

Branch: `RAI-spedition-driver-app`  
Profil UI: `VITE_APP_PROFILE=documents`

## Ce face

- **Șofer** → `/driver-app` (upload avize, profil)
- **Admin / birou** → doar **Avize / Rapoarte** și **Rapoarte**; restul ecranelor sunt ascunse și blocate
- **Bază de date, JWT, upload-uri, porturi** — complet separate de Transitix principal

## VM — folder nou

```bash
cd ~/Transitix                    # proiectul mare (lăsat neschimbat)
git fetch origin
git worktree add ../transitix-rai-documents RAI-spedition-driver-app
cd ../transitix-rai-documents
git pull origin RAI-spedition-driver-app
```

## VM — infrastructură izolată

```bash
docker compose -f docker-compose.companion.yml up -d --build
curl -s http://127.0.0.1:8101/health
```

| Serviciu | Port host | Notă |
|----------|-----------|------|
| Postgres `transitix_rai` | **5435** | alt volume, altă bază |
| Paddle OCR | **8101** | nu 8100 (evită conflict cu alt stack) |

## VM — config

```bash
cp server/companion.env.example server/.env
cp companion.env.example .env.companion
nano server/.env          # JWT_SECRET propriu, CLIENT_ORIGIN=http://IP_VM:5174
nano .env.companion
```

`server/.env` — **nu** refolosi `DATABASE_URL` sau `JWT_SECRET` de la Transitix mare.

## VM — instalare + bază nouă

```bash
npm install
npm install --prefix server
npm run db:migrate
npm run db:seed
```

Conturi seed (instanță separată):

- Admin: `admin@transitix.ro` / `admin123` → aterizează pe **Avize / Rapoarte**
- Șofer: `sofer@transitix.ro` / `sofer123` → **App Șofer**

## VM — pornire

```bash
# terminal 1
npm run dev --prefix server          # API :3002 (din server/.env)

# terminal 2
npm run dev:companion                # UI :5174, mod documents
```

Browser: `http://IP_VM:5174`

## Coexistență cu Transitix mare

| | Transitix mare | Companion RAI |
|--|----------------|---------------|
| Folder | `~/Transitix` | `~/transitix-rai-documents` |
| Branch | `RAI-spedition` / `main` | `RAI-spedition-driver-app` |
| UI | `:5173` sau `:8082` | `:5174` |
| API | `:3001` | `:3002` |
| Postgres | `:5434` / `transitix` | `:5435` / `transitix_rai` |
| Paddle | opțional | `:8101` |

Zero legătură între instanțe — date, sesiuni, fișiere upload.
