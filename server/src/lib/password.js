/**
 * What counts as an acceptable password.
 *
 * There were two answers before this file: `reset-password` demanded six characters, and
 * `register` demanded nothing at all — a company could be created with a one-character password
 * and nothing would object. Six was already below any current guidance; zero is not a policy.
 *
 * The rule here is **length plus a blocklist, and no composition rules**. Demanding an uppercase,
 * a digit and a symbol is what produces `Parola1!` on every account in the company — it measures
 * compliance with a rule rather than resistance to guessing. NIST dropped composition rules for
 * exactly this reason. Length is what actually costs an attacker time, and the blocklist catches
 * the handful of strings people reach for when told "make it long".
 */

export const MIN_LENGTH = 10;
export const MAX_LENGTH = 200;

/**
 * Strings that pass a length check and stop nobody.
 *
 * Deliberately short and Romanian-aware: this is not a leaked-password corpus, it is the list of
 * things somebody types when a form says "at least 10 characters". A full corpus check belongs
 * behind a service, not in a repository.
 */
const COMMON = [
  'parola', 'password', 'passw0rd', 'qwerty', 'asdfgh', 'zxcvbn',
  '1234567890', '0987654321', '123456789', 'abcdefghij',
  'admin', 'administrator', 'transitix', 'letmein', 'welcome',
  'iloveyou', 'monkey', 'dragon', 'sofer', 'camion',
];

/** A password that is one word repeated — `abcabcabca` — is as guessable as the word. */
function isRepeated(value) {
  for (let size = 1; size <= value.length / 2; size += 1) {
    const unit = value.slice(0, size);
    if (unit.repeat(Math.ceil(value.length / size)).slice(0, value.length) === value) return true;
  }
  return false;
}

/** A run of the same character, or a straight walk up or down the alphabet or the keypad. */
function isSequential(value) {
  if (/^(.)\1+$/.test(value)) return true;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i += 1) {
    const step = value.charCodeAt(i) - value.charCodeAt(i - 1);
    if (step !== 1) ascending = false;
    if (step !== -1) descending = false;
  }
  return ascending || descending;
}

/**
 * Checks a password, returning every problem at once.
 *
 * `context` carries things the password must not simply repeat — the person's own email or name.
 * "ana.pop@firma.ro" is long, passes a blocklist, and is the first thing anybody would try.
 */
export function checkPassword(password, context = {}) {
  const value = String(password ?? '');
  const errors = [];

  if (value.length < MIN_LENGTH) {
    errors.push(`Parola trebuie să aibă cel puțin ${MIN_LENGTH} caractere.`);
  }
  if (value.length > MAX_LENGTH) {
    // Not a security rule — a guard on how much work bcrypt is asked to do per request.
    errors.push(`Parola nu poate depăși ${MAX_LENGTH} de caractere.`);
  }
  if (value.trim() !== value) {
    // A leading or trailing space is almost always a paste accident, and it locks the account
    // out of every future login typed by hand.
    errors.push('Parola nu poate începe sau se termina cu spațiu.');
  }

  const lowered = value.toLowerCase();
  if (COMMON.some((word) => lowered === word || lowered.startsWith(word))) {
    errors.push('Parola e prea ușor de ghicit. Alege altceva.');
  }
  if (value.length >= MIN_LENGTH && (isRepeated(lowered) || isSequential(lowered))) {
    errors.push('Parola e o secvență previzibilă. Alege altceva.');
  }

  for (const [label, raw] of [['emailul', context.email], ['numele', context.name]]) {
    const own = String(raw || '').toLowerCase().trim();
    // Short fragments would reject far too much; the concern is using the whole thing.
    if (own.length >= 4 && (lowered.includes(own) || own.includes(lowered))) {
      errors.push(`Parola nu poate conține ${label}.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** One message for an API response — every problem, in one sentence per problem. */
export function passwordError(password, context) {
  const result = checkPassword(password, context);
  return result.ok ? null : result.errors.join(' ');
}

/**
 * What the screen should tell somebody *before* they type, rather than after they are rejected.
 *
 * A rule discovered only by failing it is a rule that feels arbitrary.
 */
export const PASSWORD_HINT =
  `Cel puțin ${MIN_LENGTH} caractere. Fără reguli de majuscule sau simboluri — `
  + 'o frază lungă e mai bună decât una scurtă cu semne.';
