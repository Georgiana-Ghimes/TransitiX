#50 Șabloane: duplicate names

`newTemplate()` always set `name: 'Șablon nou'`. POST/PUT `/avize/templates`
did not check uniqueness (`from-preset` already did).

Names are unique per company, case-insensitive. Clash → 409
„Există deja un șablon cu acest nume”. Unique index on
`(company_id, lower(name))` after renaming existing duplicates.
New-template editor suggests „Șablon nou (2)” when the base is taken.
