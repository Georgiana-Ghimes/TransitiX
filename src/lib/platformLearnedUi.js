/** Labels for the GOD „Date învățate” page (#112). Kept out of the page so they are testable. */

export const LEARNED_TRUST_LABEL = {
  trusted: 'de încredere',
  candidate: 'candidată',
  disabled: 'dezactivată',
};

export const LEARNED_SOURCE_LABEL = {
  parsed: 'citită din avize',
  corrected: 'corectată de birou',
  manual: 'introdusă manual',
};

export function learnedTrustClass(trust) {
  if (trust === 'trusted') return 'bg-emerald-50 text-emerald-700';
  if (trust === 'disabled') return 'bg-red-50 text-red-700';
  return 'bg-amber-50 text-amber-800';
}
