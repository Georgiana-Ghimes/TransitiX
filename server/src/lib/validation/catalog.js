/**
 * What each rule looks for, and why it is worth an alert.
 *
 * The screen reads this rather than carrying its own copy of the explanations, so a rule and its
 * justification cannot drift apart. If a rule cannot be given a concrete consequence here, it
 * does not belong in `rules.js` either.
 */
export const RULES = [
  {
    id: 'trip_no_tariff',
    severity: 'error',
    label: 'Cursă fără tarif valabil',
    consequence: 'TPO-ul se calculează fără linia de transport, deci cursa se facturează sub valoare.',
    fix: 'Adaugă un tarif contractual valabil la data cursei pentru clasa vehiculului.',
  },
  {
    id: 'tpo_total_mismatch',
    severity: 'error',
    label: 'Total TPO diferit de suma liniilor',
    consequence: 'Documentul nu-și mai explică propria cifră — una dintre cele două a fost editată separat.',
    fix: 'Recalculează TPO-ul sau verifică liniile adăugate manual.',
  },
  {
    id: 'trip_no_distance',
    severity: 'warning',
    label: 'TPO calculat fără kilometri',
    consequence: 'Lipsește componenta de kilometri din valoarea cursei.',
    fix: 'Verifică dacă rutarea (OSRM) este configurată, apoi recalculează distanța.',
  },
  {
    id: 'tpo_stale',
    severity: 'warning',
    label: 'Cursă modificată după calculul TPO',
    consequence: 'Valoarea stocată poate să nu mai corespundă cursei, dar arată ca și cum ar fi la zi.',
    fix: 'Recalculează TPO-ul cursei.',
  },
  {
    id: 'cmr_unsigned',
    severity: 'warning',
    label: 'CMR digital nesemnat la livrare',
    consequence: 'Cursa e livrată, dar predarea mărfii nu are nicio semnătură în spate.',
    fix: 'Cere destinatarului semnătura pe CMR-ul digital, sau atașează CMR-ul pe hârtie.',
  },
  {
    id: 'document_no_weight',
    severity: 'warning',
    label: 'Aviz confirmat fără greutate brută',
    consequence: 'Raportul construit din el nu poate fi confruntat cu bonul de cântar.',
    fix: 'Completează greutatea brută pe document.',
  },
  {
    id: 'document_unlinked',
    severity: 'warning',
    label: 'Aviz confirmat nelegat de cursă',
    consequence: 'Documentul nu aparține niciunei curse, deci nu va ajunge pe nicio factură.',
    fix: 'Leagă avizul de cursa corespunzătoare.',
  },
  {
    id: 'document_duplicate_tpo',
    severity: 'warning',
    label: 'Același TPO pe mai multe documente',
    consequence: 'Anexa va conține același număr de mai multe ori și nu se mai poate reconcilia.',
    fix: 'Corectează numărul pe documentele greșite.',
  },
];

const BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export function getRule(id) {
  return BY_ID.get(String(id || '')) || null;
}
