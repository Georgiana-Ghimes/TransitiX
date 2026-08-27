import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ocrProvider, paddleOcrUrl } from './readText.js';

describe('ocr provider selection', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  beforeEach(() => {
    delete process.env.OCR_PROVIDER;
    delete process.env.PADDLE_OCR_URL;
    delete process.env.GOOGLE_VISION_API_KEY;
  });

  it('defaults to none when nothing is configured', () => {
    expect(ocrProvider()).toBe('none');
  });

  it('auto-selects paddle when PADDLE_OCR_URL is set', () => {
    process.env.PADDLE_OCR_URL = 'http://127.0.0.1:8100/';
    expect(ocrProvider()).toBe('paddle');
    expect(paddleOcrUrl()).toBe('http://127.0.0.1:8100');
  });

  it('auto-selects vision when only the Google key is set', () => {
    process.env.GOOGLE_VISION_API_KEY = 'test-key';
    expect(ocrProvider()).toBe('vision');
  });

  it('honours explicit OCR_PROVIDER=paddle', () => {
    process.env.OCR_PROVIDER = 'paddle';
    process.env.GOOGLE_VISION_API_KEY = 'test-key';
    expect(ocrProvider()).toBe('paddle');
  });

  it('honours OCR_PROVIDER=none', () => {
    process.env.OCR_PROVIDER = 'none';
    process.env.PADDLE_OCR_URL = 'http://127.0.0.1:8100';
    expect(ocrProvider()).toBe('none');
  });
});
