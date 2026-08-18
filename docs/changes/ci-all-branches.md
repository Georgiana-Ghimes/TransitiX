# CI on every push

## What

GitHub Actions **CI** (`.github/workflows/ci.yml`) now runs on **every push and pull request**, not only `main`.

Steps stay: `npm ci` (root + server) → lint → `npm test` (Vitest) → frontend build.

Also: `src/lib/avizAnnex.test.js` keeps the Editează field list aligned with Anexa XLSX sources.

## Verify

```bash
npm test
npm run lint
```

Push any branch and open the **CI** check on GitHub.
