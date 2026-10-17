# Re-extrage: UI race + tab pdf-parse pe adresa

## De ce „nu se întâmpla nimic”
Re-extrage răspunde 202 și termină în fundal. `load()` imediat după lua snapshot-ul vechi, iar `busyId` bloca poll-ul de 15s — lista/formularul rămâneau pe ruta veche deși DB era deja corectă.

În DB, TPO-0031027 avea deja `Str. Republicii nr. 1F, Bolintin-Deal` după fix-ul de parser.

## Fix UI
`waitForAvizExtractSettled` așteaptă status ≠ `uploaded`, apoi actualizează rândul (+ formularul Editează dacă e deschis).

## Fix parser (text layer cu tab)
`str. Republicii,\tIF Bolintin-Deal RO…` — celula din dreapta e nr+localitate, nu Client; `leftColumnFromInterleaved` o păstrează.
