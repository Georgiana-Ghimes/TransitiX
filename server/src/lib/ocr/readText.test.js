import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  backgroundOcrTimeoutMs,
  interactiveOcrMaxPages,
  interactiveOcrTimeoutMs,
  ocrProvider,
  paddleOcrUrl,
} from './readText.js';

describe('ocr provider selection', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  beforeEach(() => {
    delete process.env.OCR_PROVIDER;
    delete process.env.PADDLE_OCR_URL;
  });

  it('defaults to none when nothing is configured', () => {
    expect(ocrProvider()).toBe('none');
  });

  it('auto-selects paddle when PADDLE_OCR_URL is set', () => {
    process.env.PADDLE_OCR_URL = 'http://127.0.0.1:8100/';
    expect(ocrProvider()).toBe('paddle');
    expect(paddleOcrUrl()).toBe('http://127.0.0.1:8100');
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
    expect(interactiveOcrTimeoutMs()).toBe(45_000);
    expect(interactiveOcrTimeoutMs()).toBeLessThan(backgroundOcrTimeoutMs());
  });

  it('grows the background budget with the pages too, so a long scan can finish', () => {
    expect(backgroundOcrTimeoutMs(1)).toBe(300_000);
    expect(backgroundOcrTimeoutMs(12)).toBe(1_200_000);
    expect(backgroundOcrTimeoutMs(500)).toBe(1_200_000);
  });

  it('grows the interactive budget with the pages, but keeps it bounded', () => {
    expect(interactiveOcrTimeoutMs(1)).toBe(45_000);
    expect(interactiveOcrTimeoutMs(2)).toBe(90_000);
    // A spinner is never allowed to run away, however long the document is — past the page
    // threshold the work belongs in the background anyway.
    expect(interactiveOcrTimeoutMs(30)).toBe(90_000);
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
    // Port 1 refuses immediately — "configured but down", which is the case that silently
    // produces documents with no OCR.
    process.env.PADDLE_OCR_URL = 'http://127.0.0.1:1';
    const { ocrCapability } = await import('./readText.js');
    expect(await ocrCapability()).toBe('paddle-down');
  });
});
