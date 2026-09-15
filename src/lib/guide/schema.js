/**
 * The shape a guide is written in, and the few rules that keep it honest.
 *
 * Guides are data, not JSX, for two reasons. A section can be searched, counted and tested
 * when it is data: the test suite can assert that every section has an anchor and that no
 * section is empty, which is the difference between a guide that rots quietly and one that
 * fails the build when somebody deletes half of it. And the same content renders into the
 * office sidebar and into a phone-sized sheet without being written twice.
 *
 * A block is the smallest unit: a paragraph, a numbered procedure, a list of terms, or a
 * callout. Nothing here carries styling, the renderer decides that.
 */

export const BLOCK_TYPES = ['p', 'steps', 'terms', 'note', 'warn'];

export const p = (text) => ({ type: 'p', text });
export const steps = (items) => ({ type: 'steps', items });
export const terms = (items) => ({ type: 'terms', items });
export const note = (text) => ({ type: 'note', text });
export const warn = (text) => ({ type: 'warn', text });

/** Every word a reader could search a block by. */
export function blockText(block) {
  if (!block) return '';
  switch (block.type) {
    case 'steps':
      return (block.items ?? []).join(' ');
    case 'terms':
      return (block.items ?? []).map((t) => `${t.term} ${t.text}`).join(' ');
    default:
      return String(block.text ?? '');
  }
}

/** Title, lead and every block, as one string to match against. */
export function sectionText(section) {
  return [
    section?.title,
    section?.lead,
    ...(section?.blocks ?? []).map(blockText),
  ].filter(Boolean).join(' ');
}

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[şş]/g, 's')
    .replace(/[ţţ]/g, 't');
}

/**
 * Sections matching every word typed, in any order and without diacritics.
 *
 * Word by word rather than as one substring: an operator looking for the weight rule types
 * "greutate bruta" and the sentence that explains it says "greutatea brută de pe aviz". A
 * substring search finds nothing there, which reads as "the guide does not cover it" for the
 * one topic it covers at length.
 */
export function searchSections(sections, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return sections ?? [];
  return (sections ?? []).filter((section) => {
    const hay = fold(sectionText(section));
    return words.every((word) => hay.includes(word));
  });
}
