# Transitix

SaaS TMS pentru managementul transporturilor rutiere.

## Stack

- **Frontend:** React + Vite + Tailwind
- **Backend:** Node.js + Express
- **Database:** PostgreSQL

## Setup local

### 1. PostgreSQL

Asigură-te că PostgreSQL rulează, apoi creează baza (dacă nu există):

```bash
psql -U postgres -c "CREATE DATABASE transitix;"
```

Credentiale default (dev): `postgres` / `password` pe `localhost:5432`.

### 2. Backend

```bash
cd server
npm install
npm run migrate
npm run seed
npm run dev
```

API: `http://localhost:3001`

Cont seed:
- Email: `admin@transitix.ro`
- Parolă: `admin123`

### 3. Frontend

```bash
npm install
npm run dev
```

App: `http://localhost:5173` (proxy `/api` → backend)

## Scripts utile

| Comandă | Descriere |
|---------|-----------|
| `npm run dev` | Frontend Vite |
| `npm run dev:server` | Backend Express |
| `npm run db:migrate` | Rulează migrările |
| `npm run db:seed` | Seed admin demo |
