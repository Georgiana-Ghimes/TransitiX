import { describe, expect, it } from 'vitest';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

describe('pdf.js worker asset', () => {
  it('points at the bundled worker, not a public CDN', () => {
    expect(String(workerUrl)).toMatch(/pdf\.worker/i);
    expect(String(workerUrl)).not.toMatch(/mozilla\.github\.io/i);
  });
});
