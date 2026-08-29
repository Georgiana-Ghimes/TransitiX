import { useCallback, useState } from 'react';
import { FORM_ERROR_BANNER, firstErrorKey } from '@/lib/entityValidation';
import { friendlyErrorMessage } from '@/lib/notify';

/**
 * The save path shared by the office modals — Client, Șofer, Factură, Produs depozit.
 *
 * Each of them used to trust `required` on the input, which counts a string of spaces as filled
 * in, and reported failures through a toast that a modal on a phone covers. This keeps the three
 * pieces that make a rejection readable in one place: per-field messages, a banner that stays on
 * screen, and focus moved to the first field that needs fixing.
 *
 * @param {object}   options.initial   starting form state
 * @param {Function} options.validate  form -> { field: message }, empty when valid
 * @param {Function} options.normalize form -> payload actually sent (trimmed, blanks nulled)
 * @param {string}   options.idPrefix  DOM id namespace, so focus can find the offending input
 * @param {Function} options.save      async payload -> void; throws to show the banner
 */
export function useEntityForm({ initial, validate, normalize, idPrefix, save }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const clearFeedback = useCallback((keys) => {
    setErrors((prev) => {
      if (!keys.some((k) => prev[k])) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
    setFormError((prev) => (prev ? '' : prev));
  }, []);

  /** Single field. Clearing its error on edit keeps a message from outliving the value it judged. */
  const set = useCallback((key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    clearFeedback([key]);
  }, [clearFeedback]);

  /** Several fields at once — picking a trip, recomputing totals. */
  const patch = useCallback((changes) => {
    setForm((f) => ({ ...f, ...changes }));
    clearFeedback(Object.keys(changes));
  }, [clearFeedback]);

  const fieldId = useCallback((key) => `${idPrefix}-${key}`, [idPrefix]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    const firstKey = firstErrorKey(nextErrors);
    if (firstKey) {
      setFormError(FORM_ERROR_BANNER);
      document.getElementById(fieldId(firstKey))?.focus();
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      await save(normalize(form));
    } catch (err) {
      console.error(err);
      setFormError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return { form, setForm, set, patch, errors, setErrors, formError, setFormError, saving, fieldId, handleSubmit };
}
