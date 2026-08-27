/**
 * Cheap post-corrections on raw OCR text before field extraction.
 *
 * Photo OCR (especially handwriting) mangles logistics codes and plates in
 * predictable ways: missing L in PSL, O/0 in TPO, glued plates without spaces.
 * These fixes are conservative — only rewrite when the shape already looks like
 * a known document code or Romanian plate.
 */

const COUNTY = (
  'B|AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|'
  + 'HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VL|VS|VN'
);

const DIGIT_CONFUSION = Object.freeze({
  I: '1',
  L: '1',
  C: '0',
  O: '0',
  P: '0',
});

/** Map common OCR digit/letter confusions inside numeric code tails. */
function normalizeCodeDigits(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[ILCOP]/g, (ch) => DIGIT_CONFUSION[ch] || ch)
    .replace(/[^0-9]/g, '');
}

function formatPrefixedCode(prefix, digits) {
  const clean = normalizeCodeDigits(digits);
  if (clean.length < 4) return null;
  return `${prefix}-${clean}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function normalizeOcrText(text) {
  let out = String(text || '');
  if (!out.trim()) return out;

  // Separate glued prefixes: expeditiePSL-… / transport_TPO-…
  out = out.replace(/([a-zăâîșț])(PSL|TPO|TRO)(?=[\s\-._]*\d)/gi, '$1 $2');
  out = out.replace(/_(TPO|PSL|TRO)(?=[\s\-._]*[\dOIl])/gi, ' $1');

  // PSL: PS / PSI / PS1 / P5L + digit tail → PSL-######
  out = out.replace(
    /(^|[^A-Za-z0-9])(P[\s]?[S5][\s]?[L1I]?)[\s\-._]*([0-9OIl]{4,10})\b/gi,
    (full, lead, _prefix, digits) => {
      const code = formatPrefixedCode('PSL', digits);
      return code ? `${lead}${code}` : full;
    }
  );

  // TPO: TP0 / TPQ / TPO + digit tail
  out = out.replace(
    /(^|[^A-Za-z0-9])(T[\s]?P[\s]?[O0Q])[\s\-._]*([0-9OIl]{4,10})\b/gi,
    (full, lead, _prefix, digits) => {
      const code = formatPrefixedCode('TPO', digits);
      return code ? `${lead}${code}` : full;
    }
  );

  // TRO codes (Baumit variant)
  out = out.replace(
    /(^|[^A-Za-z0-9])(T[\s]?R[\s]?[O0])[\s\-._]*([0-9OIl]{4,10})\b/gi,
    (full, lead, _prefix, digits) => {
      const code = formatPrefixedCode('TRO', digits);
      return code ? `${lead}${code}` : full;
    }
  );

  // Romanian plates: B330SRS / B-330-SRS / B 330SRS → B 330 SRS
  const plateRe = new RegExp(
    `(^|[^A-Za-z0-9])(${COUNTY})[\\s.\\-]*(\\d{2,3})[\\s.\\-]*([A-Z]{3})(?=$|[^A-Za-z0-9])`,
    'gi'
  );
  out = out.replace(plateRe, (_full, lead, county, num, letters) => (
    `${lead}${String(county).toUpperCase()} ${num} ${String(letters).toUpperCase()}`
  ));

  return out;
}
