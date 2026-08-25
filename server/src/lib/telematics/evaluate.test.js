import { describe, expect, it, vi } from 'vitest';

vi.mock('../email.js', () => ({
  sendEmail: vi.fn(async () => ({ ok: true, stub: true })),
}));

import { sendEmail } from '../email.js';
import { notifyClientsOfDelay } from './evaluate.js';

describe('notifyClientsOfDelay', () => {
  it('mails each distinct client email once for stops from fromSeq', async () => {
    sendEmail.mockClear();
    const result = await notifyClientsOfDelay(
      [
        {
          seq: 1, status: 'planificat', client_email: 'a@ex.com', client_name: 'A',
          order_number: 'CMD-1', planned_arrival: '2026-08-25T10:00:00.000Z',
        },
        {
          seq: 2, status: 'planificat', client_email: 'a@ex.com',
          planned_arrival: '2026-08-25T11:00:00.000Z',
        },
        {
          seq: 3, status: 'planificat', client_email: 'b@ex.com',
          planned_arrival: '2026-08-25T12:00:00.000Z',
        },
        { seq: 0, status: 'planificat', client_email: 'skip@ex.com' },
      ],
      { fromSeq: 1, delayMin: 25, routeCode: 'R-9' }
    );
    expect(result.sent).toBe(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls[0][0].to).toBe('a@ex.com');
    expect(sendEmail.mock.calls[0][0].subject).toContain('R-9');
  });
});
