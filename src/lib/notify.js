import { toast } from '@/components/ui/use-toast';

/**
 * What a person is told when something fails.
 *
 * Everything the app shows on an error comes through here, so this is the one place that decides
 * whether the reader gets a sentence or a stack-trace fragment. The people using the documents
 * companion are dispatchers and drivers, not engineers: `Failed to fetch` and `Unexpected field`
 * are not messages, they are leaks.
 */

/** Copy for the HTTP statuses, used when the server had nothing better to say. */
const STATUS_COPY = {
  400: 'Datele trimise nu sunt valide. Verifică ce ai completat.',
  401: 'Sesiunea a expirat. Autentifică-te din nou.',
  403: 'Nu ai acces la această secțiune.',
  404: 'Nu am găsit ce ai cerut. Poate a fost șters între timp.',
  409: 'Altcineva a modificat aceleași date. Reîncarcă pagina și încearcă din nou.',
  413: 'Fișierul este prea mare.',
  422: 'Datele trimise nu pot fi procesate. Verifică ce ai completat.',
  429: 'Prea multe cereri într-un timp scurt. Așteaptă un minut și încearcă din nou.',
  500: 'A apărut o eroare pe server. Încearcă din nou.',
  502: 'Serverul nu răspunde. Încearcă din nou în câteva momente.',
  503: 'Serviciul nu este disponibil acum. Încearcă din nou în câteva momente.',
  504: 'Operația a durat prea mult și a fost oprită. Încearcă din nou.',
};

/**
 * Text that reached us from a library or a status line rather than from someone writing for a
 * reader. Recognised so the status copy wins over it — never shown as-is.
 */
const BOILERPLATE = new RegExp([
  'failed to fetch',
  'networkerror',
  'load failed',
  'network request failed',
  'request failed',
  'unexpected field',
  'file too large',
  'too many files',
  'unauthorized',
  'forbidden',
  'not found',
  'bad request',
  'internal server error',
  'service unavailable',
  'gateway timeout',
  'invalid json body',
  'unexpected end of json input',
].join('|'), 'i');

/**
 * Statuses where the status copy always wins.
 *
 * "Not signed in" and "not allowed here" mean exactly one thing to a reader, and no phrasing the
 * server invents improves on it — `Invalid or expired token` describes a token, not a next step.
 */
const STATUS_WINS = new Set([401, 403]);

/** No response at all — the phone lost signal, or the API is not running. */
const OFFLINE = /failed to fetch|networkerror|load failed|network request failed/i;

export function isOfflineError(errorOrMessage) {
  const msg = typeof errorOrMessage === 'string'
    ? errorOrMessage
    : errorOrMessage?.message || '';
  return OFFLINE.test(msg);
}

/** Map common API/DB errors to short Romanian copy. */
export function friendlyErrorMessage(errorOrMessage) {
  const isString = typeof errorOrMessage === 'string';
  const status = isString ? undefined : errorOrMessage?.status;
  const msg = isString
    ? errorOrMessage
    : errorOrMessage?.message || errorOrMessage?.data?.message || 'Eroare necunoscută';

  // A request that never reached the server is not a server error, and saying so is the
  // difference between "check your signal" and "call the office".
  if (OFFLINE.test(msg)) {
    return 'Nu am putut contacta serverul. Verifică conexiunea la internet și încearcă din nou.';
  }

  if (/out of range for type integer/i.test(msg)) {
    return 'Un număr e prea mare pentru An, Capacitate (kg/mc) sau Kilometraj (max. 2.147.483.647).';
  }
  if (/numeric field overflow/i.test(msg)) {
    return 'Valoare numerică prea mare (ex. consum max 999.99). Verifică câmpurile numerice.';
  }
  if (/duplicate key|unique constraint/i.test(msg)) {
    if (/companies_slug|slug/i.test(msg)) {
      return 'Slug-ul firmei este deja folosit. Alege altul sau sincronizează din nou.';
    }
    if (/users_email|email/i.test(msg)) {
      return 'Există deja un cont cu acest email pe platformă.';
    }
    return 'Există deja o înregistrare cu aceste date (conflict de unicitate).';
  }
  if (/violates check constraint/i.test(msg)) {
    return 'Valoare invalidă pentru unul din câmpurile cu listă fixă (status, tip combustibil, etc.).';
  }
  if (/invalid input syntax/i.test(msg)) {
    return 'Format invalid pentru unul din câmpuri. Verifică datele și numerele introduse.';
  }

  // A message written for a reader beats generic status copy — that is the whole point of the
  // server bothering to write one. Boilerplate does not count as one, and neither does anything
  // arriving with a status that already says all there is to say.
  if (!STATUS_WINS.has(status) && msg && msg !== 'Eroare necunoscută' && !BOILERPLATE.test(msg)) {
    return msg;
  }

  return STATUS_COPY[status] || 'A apărut o eroare neașteptată. Încearcă din nou.';
}

/**
 * A title that matches what happened, so "Prea multe cereri" does not arrive under a heading
 * that reads as a breakdown.
 */
export function errorTitle(fallback, errorOrMessage) {
  const status = typeof errorOrMessage === 'string' ? undefined : errorOrMessage?.status;
  if (isOfflineError(errorOrMessage)) return 'Fără conexiune';
  if (status === 401) return 'Sesiune expirată';
  if (status === 403) return 'Acces restricționat';
  if (status === 429) return 'Prea multe cereri';
  return fallback;
}

/**
 * @param {string} title            what failed
 * @param {unknown} [errorOrMessage] the error, when there is one
 *
 * Called with one argument, that argument is the whole message. Bolting a generic second line
 * under it ("A apărut o eroare neașteptată") adds nothing a reader can use and makes a precise
 * message look like a system failure.
 */
export function notifyError(title, errorOrMessage) {
  const hasError = arguments.length > 1 && errorOrMessage !== undefined;
  toast({
    title: hasError ? errorTitle(title, errorOrMessage) : title,
    description: hasError ? friendlyErrorMessage(errorOrMessage) : undefined,
    variant: 'destructive',
  });
}

export function notifySuccess(title, description) {
  toast({ title, description });
}
