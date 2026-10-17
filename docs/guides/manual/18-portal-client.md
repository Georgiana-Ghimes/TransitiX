# 18. Portalul clientului

## Ce face

O pagină publică, deschisă cu un link unic, pe care **destinatarul** confirmă că a primit marfa.

Nu are nevoie de cont și nu vede nimic altceva din sistem.

## Ce vede destinatarul

- **Expeditor** și **destinatar**
- Descrierea mărfii, **greutate**, **colete**, **distanță**
- Numărul CMR-ului

## Ce face destinatarul

1. Verifică datele.
2. Dacă e ceva în neregulă, bifează **„Marfa prezintă avarii"** și descrie ce.
3. Poate adăuga **observații**.
4. Confirmă recepția.

După confirmare vede „Confirmare înregistrată". Un link deja folosit sau expirat spune „Link
invalid sau expirat".

## Unde ajunge

Confirmarea apare în [detaliul cursei](06-curse.md), cu observațiile și avariile semnalate.

## Ce urmărim

- **Rată mare de confirmare.** O livrare neconfirmată e o livrare fără dovadă din partea celui
  care a primit-o.
- **Zero avarii semnalate** — și, când apar, semnalate rapid, cât timp se mai poate stabili unde
  s-au produs.
- **Timp scurt între livrare și confirmare.**

## Ce poate merge prost

- **Clientul spune că linkul nu merge:** e expirat sau deja folosit. Se regenerează din cursă.
- **Nimeni nu confirmă:** linkul n-a ajuns la persoana potrivită. Verifică adresa de email a
  destinatarului.
