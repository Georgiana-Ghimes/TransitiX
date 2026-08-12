import { toast } from '@/components/ui/use-toast';

/** Map common API/DB errors to short Romanian copy. */
export function friendlyErrorMessage(errorOrMessage) {
  const msg =
    typeof errorOrMessage === 'string'
      ? errorOrMessage
      : errorOrMessage?.message || errorOrMessage?.data?.message || 'Eroare necunoscută';

  if (/numeric field overflow/i.test(msg)) {
    return 'Valoare numerică prea mare (ex. consum max 999.99, capacitate etc.). Verifică câmpurile numerice.';
  }
  if (/duplicate key|unique constraint/i.test(msg)) {
    return 'Există deja o înregistrare cu aceste date (ex. număr înmatriculare duplicat).';
  }
  if (/violates check constraint/i.test(msg)) {
    return 'Valoare invalidă pentru unul din câmpurile cu listă fixă (status, tip combustibil, etc.).';
  }
  if (/invalid input syntax/i.test(msg)) {
    return 'Format invalid pentru unul din câmpuri. Verifică datele și numerele introduse.';
  }
  return msg;
}

export function notifyError(title, errorOrMessage) {
  toast({
    title,
    description: friendlyErrorMessage(errorOrMessage),
    variant: 'destructive',
  });
}

export function notifySuccess(title, description) {
  toast({ title, description });
}
