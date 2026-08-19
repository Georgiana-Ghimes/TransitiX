# Production foundation — încredere față de piața TMS RO

**Versiune:** 1.8.0 (sidebar, login, tab, `/api/health`).  
Increment după 1.7.1. Plan: [`docs/romania-tms-production.plan.md`](../romania-tms-production.plan.md).

## Ce s-a schimbat

- GPS / Planning AI / e-Factura sunt etichetate **demo** (nu SPV, nu telematică live)
- Fișierele noi: `c-{company_id}-…`; citirea `/uploads` e pe firmă
- Facturi: contor per serie, nu `Math.random` / `COUNT(*)`
- Curse: UIT manual, CUI, venit/cost, marjă în listă și detaliu
- Health: `capabilities` (`efactura: false`, `gps: simulate`, Vision, email)
- Extract avize: 30/min/firmă

## Cum verifici

1. `npm run db:migrate` (coloane `trips.uit_code`, tabel `invoice_counters`)
2. Restart API. `GET /api/health` → `capabilities.efactura === false`
3. `/gps`: banner + buton «Simulează poziții (demo)»
4. Factură nouă, număr gol → `TRX 0001` (sau următorul)
5. Cursă: UIT invalid scurt → 400; UIT valid se salvează
6. Upload aviz, copiază URL-ul; din alt tenant (dacă ai) → 404
