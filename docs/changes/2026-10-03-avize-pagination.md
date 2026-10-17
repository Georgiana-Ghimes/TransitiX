# Paginare listă avize (20 / 50 / 100 / 500)

## API

`GET /api/avize` răspunde `{ items, total, limit, offset }` (nu mai e un array gol).
`limit` e doar din `{20,50,100,500}` (altfel 50). Filtrele COUNT și SELECT împart același WHERE.
Badge-ul de duplicat se calculează cu frații TPO din toată firma, nu doar din pagina curentă.

## UI

Dropdown „Afișează N pe pagină”, Înapoi / Înainte, „X–Y din Z”. Preferința de page size e în
`localStorage`. Select-all = pagina curentă; selecția cross-page rămâne până la schimbarea filtrelor.
