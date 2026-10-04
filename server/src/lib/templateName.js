export const DEFAULT_NEW_TEMPLATE_NAME = 'Șablon nou';
export const TEMPLATE_NAME_TAKEN = 'Există deja un șablon cu acest nume';

/**
 * Next free name in a company, case-insensitive. „Șablon nou” taken → „Șablon nou (2)”.
 */
export function nextUnusedTemplateName(existingNames, base = DEFAULT_NEW_TEMPLATE_NAME) {
  const stem = String(base || '').trim() || DEFAULT_NEW_TEMPLATE_NAME;
  const taken = new Set(
    (existingNames || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean),
  );
  if (!taken.has(stem.toLowerCase())) return stem;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} (${Date.now()})`;
}
