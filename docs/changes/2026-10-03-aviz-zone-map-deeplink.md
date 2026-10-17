# Editează → pin pe Harta zonelor

În panoul **Taxă zonă** din Editează, linkul **Vezi pinul pe Harta zonelor** deschide `/zone-map?q=…&city=…&plate=…` (strada + număr din rută/livrare, oraș, număr auto). Harta prefill-uiește căutarea și pune pinul, ca să verifici vizual dacă adresa e în zona cu taxe.

În afara Bucureștiului (oraș fără zone): `q` include și localitatea (`strada X 1F, Bolintin-Deal`), plus `locality=…`, ca geocodarea să nu adauge tab-ul București și pinul să cadă în localitatea corectă.

Pinul pe hartă folosește Photon public (OSM) din browser (`geocodeMapPin`), nu `/zones/locate` — fără cache/praguri de încredere pe server care refuzau adresa.

- `zoneMapHref` / `zoneMapSearchQuery` în `src/lib/avizZoneTax.js`
- `AvizZoneTaxPanel` arată linkul când există adresă de livrare
- `ZoneMap` citește `q` / `address`, `city`, `locality`, `plate` și rulează căutarea la încărcare
- `src/lib/mapGeocode.js` — geocode raw pe hartă
