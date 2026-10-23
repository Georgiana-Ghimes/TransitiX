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

/** Which side of the route an address fills. Rows from before roles existed are origins. */
export const LEARNED_ROLE_LABEL = {
  origin: 'expeditor',
  delivery: 'livrare',
};

export function learnedRoleLabel(role) {
  return LEARNED_ROLE_LABEL[role || 'origin'] || role;
}

/** The edit hit an address that already exists: what the merge dialog says. */
export function mergePrompt(source, target) {
  const seen = Number(target?.seen_count) || 0;
  const trust = LEARNED_TRUST_LABEL[target?.trust] || target?.trust || '';
  return {
    title: 'Unești adresele?',
    description:
      `„${target?.display || ''}” există deja pe CP ${target?.postcode || ''}`
      + ` (${trust}, citită pe ${seen} ${seen === 1 ? 'aviz' : 'avize'}).`
      + ` „${source?.display || ''}” devine o variantă a ei: avizele citite așa se numără la adresa corectă,`
      + ' iar aceeași greșeală nu mai apare ca adresă nouă.',
  };
}

/** `Variante unite: Str. Kepublicii nr. 1F, Bolintin-Deal` — null when there are none. */
export function mergedVariantsLabel(variants) {
  const list = Array.isArray(variants) ? variants.filter((v) => v?.display) : [];
  if (!list.length) return null;
  return `${list.length === 1 ? 'Variantă unită' : 'Variante unite'}: ${list.map((v) => v.display).join(' · ')}`;
}

export function learnedTrustClass(trust) {
  if (trust === 'trusted') return 'bg-emerald-50 text-emerald-700';
  if (trust === 'disabled') return 'bg-red-50 text-red-700';
  return 'bg-amber-50 text-amber-800';
}
