# Optimizare încărcare: logo login + clipire meniuri

## Logo login

PNG-urile brand erau ~800 KB fiecare. Login încărca absolutul prin `BrandLogo` (și asset-ul dark, nefolosit).

- Asset-uri UI: `transitix-logo-color/white/mark.png` (~37 / 22 / 6 KB)
- AuthLayout importă doar color + `fetchPriority="high"`
- White logo se încarcă doar când `html.dark`

## Clipire sidebar la navigare

`Suspense` înfășura tot `Routes` → la primul hit pe un chunk lazy, fallback-ul demonta Layout/sidebar.

- Suspense mutat pe `Outlet` în Layout
- Avize + Rapoarte eager în shell
- Prefetch idle + pe hover pe linkurile din sidebar
