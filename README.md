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
- Admin: `admin@transitix.ro` / `admin123`
- Șofer: `sofer@transitix.ro` / `sofer123`

Pentru date demo (vehicule, curse active):

```bash
cd server
npm run seed:demo
```

### Cum testezi App Șofer

1. Autentifică-te cu `sofer@transitix.ro` / `sofer123`
2. Deschide **App Șofer** din meniu
3. Vei vedea cursele **alocate** ție (Active / Istoric)
4. Din dispecerat: creează cursă → selectează șofer → status devine automat `alocata` și apare în app

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
