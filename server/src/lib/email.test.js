import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { emailConfigured, sendEmail } from './email.js';

describe('emailConfigured', () => {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.EMAIL_FROM;

  afterEach(() => {
    process.env.RESEND_API_KEY = prevKey;
    process.env.EMAIL_FROM = prevFrom;
  });

  it('is false when keys are missing', () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    expect(emailConfigured()).toBe(false);
  });

  it('is true when both env vars are set', () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'Transitix <noreply@example.com>';
    expect(emailConfigured()).toBe(true);
  });
});

describe('sendEmail stub', () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  it('logs and returns stub when Resend is not configured', async () => {
    const result = await sendEmail({
      to: 'a@test.ro',
      subject: 'Hello',
      text: 'Body',
      attachments: [{ filename: 'anexa.xlsx', content: Buffer.from('x') }],
    });
    expect(result.ok).toBe(true);
    expect(result.stub).toBe(true);
  });

  it('rejects missing recipient', async () => {
    const result = await sendEmail({ subject: 'Hello' });
    expect(result.ok).toBe(false);
  });
});
