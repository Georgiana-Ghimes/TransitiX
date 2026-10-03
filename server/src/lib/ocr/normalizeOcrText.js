/**
 * Cheap post-corrections on raw OCR text before field extraction.
 *
 * Photo OCR (especially handwriting) mangles logistics codes and plates in
 * predictable ways: missing L in PSL, O/0 in TPO, glued plates without spaces.
 * These fixes are conservative, only rewrite when the shape already looks like
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
    // Handwriting OCR often injects &, $, S, B, Q into digit runs (TPO-O0&5813 / TP0-Q026813).
    .replace(/[&$SBQ]/g, '')
    .replace(/[ILCOP]/g, (ch) => DIGIT_CONFUSION[ch] || ch)
    .replace(/[^0-9]/g, '');
}

function formatPrefixedCode(prefix, digits) {
  const clean = normalizeCodeDigits(digits);
  if (clean.length < 4) return null;
  return `${prefix}-${clean}`;
}

/**
 * Provider-independent clean-up that runs before any document-specific fix.
 *
 * Whatever produced the text (Mistral, a PDF text layer, a test fixture), the extractor
 * downstream expects the same thing: one encoding, no control characters, no zero-width
 * padding, ASCII quotes and dashes, lines trimmed, no runs of blank lines. Tokens that are
 * clearly rendering junk (a run of the same symbol, box-drawing art) go too — they never
 * carry a field and they do break regexes anchored on "non-alphanumeric".
 *
 * Nothing here knows what a TPO is. Field vocabulary belongs in the profiles.
 */
export function sanitizeOcrText(text) {
  let out = String(text ?? '');
  if (!out) return out;

  out = out.normalize('NFC');
  // Zero-width / BOM / soft hyphen.
  out = out.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '');
  // Control characters except tab and newline; CR → LF.
  out = out.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  // Non-breaking and exotic spaces.
  out = out.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
  // Typographic quotes and dashes.
  out = out.replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-');
  // Markdown table rulers and box drawing (`|---|---|`, `────`) — layout, not content.
  out = out.replace(/^[\s|:\-=_]{3,}$/gm, '');
  out = out.replace(/[\u2500-\u257F]+/g, ' ');
  // Bold/italic markers from Mistral markdown (`**72.00** buc` must stay a number + unit).
  out = out.replace(/\*\*|__/g, '');
  // Quantity and unit split across table cells: `| 72.00 | buc |` → `72.00 buc`.
  out = out.replace(
    /(\d[\d.,]*)\s*\|\s*(saci?|pal(?:eti|et)?|buc(?:ati)?|pcs|pce|gal(?:eti|eata)?|ga1eti|galei)\b/gi,
    '$1 $2',
  );
  // Remaining pipes are cell borders, not content.
  out = out.replace(/\|/g, ' ');
  // A run of 4+ identical punctuation marks is a rendering artefact (`....`, `~~~~`, `####`).
  out = out.replace(/([^\w\s\n])\1{3,}/g, ' ');
  // Trailing spaces per line, collapse inner runs, cap blank lines at one.
  out = out.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function normalizeOcrText(text) {
  let out = sanitizeOcrText(text);
  if (!out.trim()) return out;

  // Separate glued prefixes: expeditiePSL-… / transport_TPO-…
  out = out.replace(/([a-zăâîșț])(PSL|TPO|TRO)(?=[\s\-._/:]*\d)/gi, '$1 $2');
  out = out.replace(/_(TPO|PSL|TRO)(?=[\s\-._/:]*[\dOIl])/gi, ' $1');

  // PSL: PS / PSI / PS1 / P5L + digit tail → PSL-######
  out = out.replace(
    /(^|[^A-Za-z0-9])(P[\s]?[S5][\s]?[L1I]?)[\s\-._/:]*([0-9OIlQq&$SsBb]{4,14})\b/gi,
    (full, lead, _prefix, digits) => {
      const code = formatPrefixedCode('PSL', digits);
      return code ? `${lead}${code}` : full;
    }
  );

  // TPO: TP0 / TPQ / TPO + digit tail (ampersands / O-as-zero / handwritten "TPO / 31027")
  out = out.replace(
    /(^|[^A-Za-z0-9])(T[\s]?P[\s]?[O0Q])[\s\-._/:]*([0-9OIlQq&$SsBb]{4,14})\b/gi,
    (full, lead, _prefix, digits) => {
      const code = formatPrefixedCode('TPO', digits);
      return code ? `${lead}${code}` : full;
    }
  );

  // TRO codes (Baumit variant)
  out = out.replace(
    /(^|[^A-Za-z0-9])(T[\s]?R[\s]?[O0])[\s\-._/:]*([0-9OIlQq&$SsBb]{4,14})\b/gi,
    (full, lead, _prefix, digits) => {
      const code = formatPrefixedCode('TRO', digits);
      return code ? `${lead}${code}` : full;
    }
  );

  // Romanian plates: B330SRS / B-330-SRS / B 33o SRS → B 330 SRS.
  // Handwriting OCR returns the number with letter look-alikes (`33o`, `1l2`), which used to
  // drop the plate entirely. Rewrite only when at least one character was a real digit.
  const plateRe = new RegExp(
    `(^|[^A-Za-z0-9])(${COUNTY})[\\s.\\-]*([0-9OoQDIl]{2,3})[\\s.\\-]*([A-Z]{3})(?=$|[^A-Za-z0-9])`,
    'gi'
  );
  out = out.replace(plateRe, (full, lead, county, num, letters) => {
    if (!/[0-9]/.test(num)) return full;
    const digits = String(num).toUpperCase().replace(/[OQD]/g, '0').replace(/[IL]/g, '1');
    if (!/^\d{2,3}$/.test(digits)) return full;
    return `${lead}${String(county).toUpperCase()} ${digits} ${String(letters).toUpperCase()}`;
  });

  return out;
}
