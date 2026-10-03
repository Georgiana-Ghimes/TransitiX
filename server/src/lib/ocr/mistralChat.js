/**
 * Mistral chat completions — JSON answers for post-OCR semantic steps.
 * Reuses MISTRAL_API_KEY / MISTRAL_API_BASE from OCR.
 */

import { mistralApiBase, mistralApiKey } from './mistralOcr.js';

export function mistralChatModel() {
  return String(process.env.MISTRAL_CHAT_MODEL || 'mistral-small-latest').trim()
    || 'mistral-small-latest';
}

export function mistralChatConfigured() {
  return Boolean(mistralApiKey());
}

/**
 * @param {{ system: string, user: string, timeoutMs?: number }} opts
 * @returns {Promise<object|null>} parsed JSON object, or null on failure
 */
export async function mistralChatJson({ system, user, timeoutMs } = {}) {
  const key = mistralApiKey();
  if (!key) return null;
  const budget = Math.max(1, Math.floor(Number(timeoutMs) || 45_000));
  const url = `${mistralApiBase()}/v1/chat/completions`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: mistralChatModel(),
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(budget),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 240);
      console.warn(`[ocr] mistral chat HTTP ${res.status}: ${detail}`);
      return null;
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') return null;
    try {
      return JSON.parse(content);
    } catch {
      console.warn('[ocr] mistral chat returned non-JSON content');
      return null;
    }
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    if (!timedOut) console.warn('[ocr] mistral chat failed:', err?.message || err);
    return null;
  }
}
