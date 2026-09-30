import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  acquireOcrSlot,
  backgroundOcrTimeoutMs,
  interactiveOcrMaxPages,
  interactiveOcrTimeoutMs,
  mimeTypeFor,
  needsOcrFallback,
  ocrConcurrency,
  ocrProvider,
  ocrQueueState,
  paddleOcrUrl,
  paddleOcrVlUrl,
  pickBestOcrText,
  recordVlOutcome,
  releaseOcrSlot,
  resetVlBreaker,
  shouldTryVl,
  vlBreakerOpen,
} from './readText.js';

describe('ocr provider selection', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  beforeEach(() => {
    delete process.env.OCR_PROVIDER;
    delete process.env.PADDLE_OCR_URL;
    delete process.env.PADDLE_OCR_VL_URL;
  });

  it('defaults to none when nothing is configured', () => {
    expect(ocrProvider()).toBe('none');
  });

  it('auto-selects paddle when PADDLE_OCR_URL is set', () => {
    process.env.PADDLE_OCR_URL = 'http://127.0.0.1:8100/';
    expect(ocrProvider()).toBe('paddle');
    expect(paddleOcrUrl()).toBe('http://127.0.0.1:8100');
  });

  it('reads optional VL sidecar URL', () => {
    process.env.PADDLE_OCR_VL_URL = 'http://127.0.0.1:8101/';
    expect(paddleOcrVlUrl()).toBe('http://127.0.0.1:8101');
  });

  it('honours explicit OCR_PROVIDER=paddle', () => {
    process.env.OCR_PROVIDER = 'paddle';
    expect(ocrProvider()).toBe('paddle');
  });

  it('has no provider left to fall back on when the sidecar URL is unset', () => {
    process.env.OCR_PROVIDER = 'vision';
    expect(ocrProvider()).toBe('none');
  });

  it('honours OCR_PROVIDER=none', () => {
    process.env.OCR_PROVIDER = 'none';
    process.env.PADDLE_OCR_URL = 'http://127.0.0.1:8100';
    expect(ocrProvider()).toBe('none');
  });
});

describe('needsOcrFallback + pickBestOcrText', () => {
  it('asks for VL when the text is thin or has no logistics codes', () => {
    expect(needsOcrFallback('abc')).toBe(true);
    expect(needsOcrFallback('Aviz de livrare fără coduri lungi pe pagină')).toBe(true);
    expect(needsOcrFallback(
      'Aviz de expeditie PSL-0044362 Comanda de transport TPO-0025629 placuta B 330 SRS'
    )).toBe(false);
  });

  it('prefers the candidate with a logistics code over a longer empty one', () => {
    const best = pickBestOcrText([
      { source: 'paddle', text: 'x'.repeat(200) },
      { source: 'paddle-vl', text: 'TPO-0025813 greutate 15744' },
    ]);
    expect(best.source).toContain('paddle-vl');
    expect(best.text).toContain('TPO-0025813');
    expect(best.engines.length).toBe(2);
  });

  it('joins sources when several engines contributed', () => {
    const best = pickBestOcrText([
      { source: 'paddle', text: 'TPO-1 short' },
      { source: 'paddle-vl', text: 'TPO-0025813 with more Romanian text ăâî' },
    ]);
    expect(best.source).toBe('paddle+paddle-vl');
  });

  it('returns null when nothing usable arrived', () => {
    expect(pickBestOcrText([{ source: 'paddle', text: '   ' }])).toBeNull();
    expect(pickBestOcrText([])).toBeNull();
  });
});

describe('ocr timeouts', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  beforeEach(() => {
    delete process.env.OCR_TIMEOUT_MS;
    delete process.env.OCR_INTERACTIVE_TIMEOUT_MS;
    delete process.env.OCR_INTERACTIVE_MAX_PAGES;
  });

  it('lets a background pass wait far longer than someone watching a spinner', () => {
    expect(backgroundOcrTimeoutMs()).toBe(300_000);
    expect(interactiveOcrTimeoutMs()).toBe(120_000);
    expect(interactiveOcrTimeoutMs()).toBeLessThan(backgroundOcrTimeoutMs());
  });

  it('grows the background budget with the pages too, so a long scan can finish', () => {
    expect(backgroundOcrTimeoutMs(1)).toBe(300_000);
    expect(backgroundOcrTimeoutMs(12)).toBe(1_200_000);
    expect(backgroundOcrTimeoutMs(500)).toBe(1_200_000);
  });

  it('grows the interactive budget with the pages, but keeps it bounded', () => {
    expect(interactiveOcrTimeoutMs(1)).toBe(120_000);
    expect(interactiveOcrTimeoutMs(2)).toBe(240_000);
    // A spinner is never allowed to run away, however long the document is, past the page
    // threshold the work belongs in the background anyway.
    expect(interactiveOcrTimeoutMs(30)).toBe(240_000);
  });

  it('sends anything past a few pages to the background', () => {
    expect(interactiveOcrMaxPages()).toBe(3);
    process.env.OCR_INTERACTIVE_MAX_PAGES = '1';
    expect(interactiveOcrMaxPages()).toBe(1);
  });

  it('takes both budgets from the environment', () => {
    process.env.OCR_TIMEOUT_MS = '120000';
    process.env.OCR_INTERACTIVE_TIMEOUT_MS = '15000';
    expect(backgroundOcrTimeoutMs()).toBe(120_000);
    expect(interactiveOcrTimeoutMs()).toBe(15_000);
  });
});

describe('VL gate', () => {
  const env = { ...process.env };

  beforeEach(() => {
    resetVlBreaker();
    process.env.PADDLE_OCR_VL_URL = 'http://127.0.0.1:8101';
    for (const key of ['OCR_VL_MAX_PAGES', 'OCR_VL_MIN_BUDGET_MS', 'OCR_VL_MAX_MISSES', 'OCR_VL_COOLDOWN_MS']) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...env };
    resetVlBreaker();
  });

  const weak = 'Aviz de livrare fără coduri lungi pe pagină';

  it('never runs without a VL URL, or when classic already read a logistics code', () => {
    expect(shouldTryVl(weak)).toBe(true);
    expect(shouldTryVl('Aviz PSL-0044362 TPO-0025629 auto B 330 SRS')).toBe(false);
    delete process.env.PADDLE_OCR_VL_URL;
    expect(shouldTryVl(weak)).toBe(false);
  });

  it('skips long PDFs and a budget too short to finish a page', () => {
    expect(shouldTryVl(weak, { pages: 2 })).toBe(true);
    expect(shouldTryVl(weak, { pages: 3 })).toBe(false);
    expect(shouldTryVl(weak, { remainingMs: 89_000 })).toBe(false);
    expect(shouldTryVl(weak, { remainingMs: 200_000 })).toBe(true);
  });

  it('pauses VL after repeated useless reads and resumes after the cooldown', () => {
    const t0 = 1_000_000;
    recordVlOutcome({ text: null, timedOut: true }, t0);
    expect(vlBreakerOpen(t0)).toBe(false);
    recordVlOutcome({ text: null }, t0);
    expect(vlBreakerOpen(t0 + 1)).toBe(true);
    expect(shouldTryVl(weak, { now: t0 + 1 })).toBe(false);
    expect(shouldTryVl(weak, { now: t0 + 30 * 60_000 + 1 })).toBe(true);
  });

  it('a VL read with text resets the miss count', () => {
    recordVlOutcome({ text: null }, 0);
    recordVlOutcome({ text: 'TPO-0025813' }, 0);
    recordVlOutcome({ text: null }, 0);
    expect(vlBreakerOpen(1)).toBe(false);
  });
});

describe('OCR queue', () => {
  afterEach(() => {
    delete process.env.OCR_CONCURRENCY;
  });

  it('runs one job at a time and hands the slot to the next waiter', async () => {
    expect(ocrConcurrency()).toBe(1);
    const far = Date.now() + 10_000;
    expect(await acquireOcrSlot(far)).toBe(true);
    const second = acquireOcrSlot(far);
    expect(ocrQueueState()).toMatchObject({ active: 1, waiting: 1 });
    releaseOcrSlot();
    expect(await second).toBe(true);
    expect(ocrQueueState()).toMatchObject({ active: 1, waiting: 0 });
    releaseOcrSlot();
    expect(ocrQueueState().active).toBe(0);
  });

  it('gives up in the queue at the deadline instead of reaching the sidecar late', async () => {
    expect(await acquireOcrSlot(Date.now() + 10_000)).toBe(true);
    expect(await acquireOcrSlot(Date.now() + 20)).toBe(false);
    expect(ocrQueueState().waiting).toBe(0);
    releaseOcrSlot();
  });
});

describe('mimeTypeFor', () => {
  it('names the real type instead of calling every upload a JPEG', () => {
    expect(mimeTypeFor('a.PDF')).toBe('application/pdf');
    expect(mimeTypeFor('scan.png')).toBe('image/png');
    expect(mimeTypeFor('x.webp')).toBe('image/webp');
    expect(mimeTypeFor('photo.jpeg')).toBe('image/jpeg');
  });
});

describe('ocrCapability', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
  });

  beforeEach(() => {
    vi.resetModules();
    delete process.env.OCR_PROVIDER;
    delete process.env.PADDLE_OCR_URL;
  });

  it('reports false when no sidecar is configured', async () => {
    const { ocrCapability } = await import('./readText.js');
    expect(await ocrCapability()).toBe(false);
  });

  it('separates a configured sidecar that will not answer from one that is absent', async () => {
    // Port 1 refuses immediately, "configured but down", which is the case that silently
    // produces documents with no OCR.
    process.env.PADDLE_OCR_URL = 'http://127.0.0.1:1';
    const { ocrCapability } = await import('./readText.js');
    expect(await ocrCapability()).toBe('paddle-down');
  });
});
