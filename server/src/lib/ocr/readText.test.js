import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  acquireOcrSlot,
  backgroundOcrTimeoutMs,
  interactiveOcrMaxPages,
  interactiveOcrTimeoutMs,
  isOcrDown,
  mimeTypeFor,
  ocrConcurrency,
  ocrProvider,
  ocrQueueState,
  releaseOcrSlot,
} from './readText.js';

describe('ocr provider selection', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  beforeEach(() => {
    delete process.env.OCR_PROVIDER;
    delete process.env.MISTRAL_API_KEY;
  });

  it('defaults to none when nothing is configured', () => {
    expect(ocrProvider()).toBe('none');
  });

  it('auto-selects mistral when MISTRAL_API_KEY is set', () => {
    process.env.MISTRAL_API_KEY = 'test-key';
    expect(ocrProvider()).toBe('mistral');
  });

  it('honours explicit OCR_PROVIDER=mistral', () => {
    process.env.OCR_PROVIDER = 'mistral';
    expect(ocrProvider()).toBe('mistral');
  });

  it('honours OCR_PROVIDER=none even with a key', () => {
    process.env.OCR_PROVIDER = 'none';
    process.env.MISTRAL_API_KEY = 'test-key';
    expect(ocrProvider()).toBe('none');
  });

  it('treats unknown provider as none without a key', () => {
    process.env.OCR_PROVIDER = 'vision';
    expect(ocrProvider()).toBe('none');
  });
});

describe('isOcrDown', () => {
  it('flags only mistral-down', () => {
    expect(isOcrDown('mistral-down')).toBe(true);
    expect(isOcrDown('mistral')).toBe(false);
    expect(isOcrDown(false)).toBe(false);
    expect(isOcrDown('paddle-down')).toBe(false);
  });
});

describe('timeouts and concurrency', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    while (ocrQueueState().active > 0) releaseOcrSlot();
  });

  it('scales budgets by page count', () => {
    process.env.OCR_TIMEOUT_MS = '100000';
    process.env.OCR_INTERACTIVE_TIMEOUT_MS = '60000';
    expect(backgroundOcrTimeoutMs(1)).toBe(100000);
    expect(backgroundOcrTimeoutMs(3)).toBe(300000);
    expect(interactiveOcrTimeoutMs(2)).toBe(120000);
    expect(interactiveOcrMaxPages()).toBe(3);
  });

  it('limits concurrent slots', async () => {
    process.env.OCR_CONCURRENCY = '1';
    expect(ocrConcurrency()).toBe(1);
    expect(await acquireOcrSlot(Date.now() + 1000)).toBe(true);
    expect(await acquireOcrSlot(Date.now() - 1)).toBe(false);
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
    // The fresh import pulls uploadPath.js → loadEnv.js, which would read a developer's
    // server/.env (and, with COMPANION=1 in the shell, .env.companion with override) straight
    // back into the environment cleared below. A unit test's answer must not depend on what
    // is in somebody's env files, so the loader is stubbed out entirely.
    vi.doMock('../../loadEnv.js', () => ({}));
    delete process.env.OCR_PROVIDER;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.COMPANION;
  });

  it('reports false when no OCR is configured', async () => {
    const { ocrCapability } = await import('./readText.js');
    expect(await ocrCapability()).toBe(false);
  });
});
