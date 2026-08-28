import { describe, expect, it, vi } from 'vitest';
import { errorTitle, friendlyErrorMessage, isOfflineError, notifyError } from './notify.js';
import { toast } from '@/components/ui/use-toast';

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

const httpError = (status, message) => Object.assign(new Error(message), { status });

describe('friendlyErrorMessage', () => {
  it('maps integer overflow to Romanian copy', () => {
    expect(friendlyErrorMessage('value out of range for type integer')).toMatch(/prea mare/);
  });

  it('maps numeric overflow to Romanian copy', () => {
    expect(friendlyErrorMessage('numeric field overflow')).toMatch(/numerică prea mare/);
  });

  it('maps duplicate key to Romanian copy', () => {
    expect(friendlyErrorMessage('duplicate key value violates unique constraint')).toMatch(/Există deja/);
  });

  it('returns plain string errors unchanged', () => {
    expect(friendlyErrorMessage('Câmp obligatoriu')).toBe('Câmp obligatoriu');
  });

  it('reads message from Error objects', () => {
    expect(friendlyErrorMessage(new Error('invalid input syntax for type integer'))).toMatch(/Format invalid/);
  });

  it('falls back to something a reader can act on', () => {
    // Was "Eroare necunoscută", which is Romanian and still tells nobody what to do.
    expect(friendlyErrorMessage({})).toMatch(/eroare neașteptată/i);
  });

  it('turns an expired session into an instruction, not a token complaint', () => {
    expect(friendlyErrorMessage(httpError(401, 'Invalid or expired token')))
      .toMatch(/Sesiunea a expirat/);
    expect(errorTitle('Eroare', httpError(401, 'Unauthorized'))).toBe('Sesiune expirată');
  });

  it('names a lost connection as such instead of blaming the server', () => {
    const offline = new TypeError('Failed to fetch');
    expect(isOfflineError(offline)).toBe(true);
    expect(friendlyErrorMessage(offline)).toMatch(/conexiunea la internet/i);
    expect(errorTitle('Încărcare eșuată', offline)).toBe('Fără conexiune');
  });

  it('reads a rate limit as "slow down", under a title that says so', () => {
    const err = httpError(429, 'Prea multe încărcări. Reîncearcă într-un minut.');
    expect(friendlyErrorMessage(err)).toMatch(/Reîncearcă într-un minut/);
    expect(errorTitle('Încărcare eșuată', err)).toBe('Prea multe cereri');
  });

  it('replaces library boilerplate that no reader can act on', () => {
    expect(friendlyErrorMessage(httpError(400, 'Unexpected field'))).toMatch(/nu sunt valide/i);
    expect(friendlyErrorMessage(httpError(413, 'File too large'))).toMatch(/prea mare/i);
    expect(friendlyErrorMessage(httpError(404, 'Not found'))).toMatch(/Nu am găsit/);
    expect(friendlyErrorMessage(httpError(500, 'Internal Server Error')))
      .toMatch(/eroare pe server/i);
  });

  it('keeps a message the server wrote for a person', () => {
    expect(friendlyErrorMessage(httpError(409, 'Cursa are deja un aviz atașat.')))
      .toBe('Cursa are deja un aviz atașat.');
  });
});

describe('notifyError', () => {
  it('shows a single-argument message on its own, with nothing invented under it', () => {
    notifyError('Doar administratorul poate salva setările companiei.');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Doar administratorul poate salva setările companiei.',
      description: undefined,
    }));
  });

  it('retitles by status and falls back to the status copy when the message is boilerplate', () => {
    notifyError('Încărcare eșuată', Object.assign(new Error('Request failed'), { status: 429 }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Prea multe cereri',
      description: expect.stringMatching(/Așteaptă un minut/),
    }));
  });

  it('keeps the server’s own wording when it wrote one for a reader', () => {
    const err = Object.assign(new Error('Prea multe încărcări. Reîncearcă într-un minut.'), {
      status: 429,
    });
    notifyError('Încărcare eșuată', err);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Prea multe cereri',
      description: 'Prea multe încărcări. Reîncearcă într-un minut.',
    }));
  });
});
