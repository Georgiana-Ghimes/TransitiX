import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OFFICE_TOUR_SEEN_KEY,
  OFFICE_TOUR_STEPS,
  clampTourStep,
  hasSeenOfficeTour,
  markOfficeTourSeen,
  tourMobileHighlightMenuButton,
  tourMobileMenuStep,
  tourNavHighlightPath,
  tourStepMobileBody,
} from './officeTour.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('office tour steps', () => {
  it('covers Avize, dispatch, finance, and demo honesty', () => {
    const ids = OFFICE_TOUR_STEPS.map((s) => s.id);
    expect(ids).toEqual(['welcome', 'avize', 'dispatch', 'finance', 'demos', 'again']);
    expect(OFFICE_TOUR_STEPS.find((s) => s.path === '/avize')).toBeTruthy();
    expect(OFFICE_TOUR_STEPS.find((s) => s.demo)).toMatchObject({ id: 'demos' });
    expect(OFFICE_TOUR_STEPS.find((s) => s.highlightTarget === 'ghid')).toMatchObject({ id: 'again' });
  });

  it('spotlights dashboard content on welcome, not the nav', () => {
    const welcome = OFFICE_TOUR_STEPS[0];
    expect(welcome.highlightTarget).toBe('dashboard');
    expect(tourNavHighlightPath(welcome)).toBeNull();
    expect(tourNavHighlightPath(OFFICE_TOUR_STEPS[1])).toBe('/avize');
  });

  it('uses shorter mobile copy and menu cues', () => {
    const welcome = OFFICE_TOUR_STEPS[0];
    expect(tourStepMobileBody(welcome)).toContain('Derulează');
    expect(tourMobileMenuStep(welcome)).toBe(false);
    expect(tourMobileMenuStep(OFFICE_TOUR_STEPS[1])).toBe(true);
    expect(tourMobileHighlightMenuButton(OFFICE_TOUR_STEPS[5])).toBe(true);
  });

  it('clamps the step index', () => {
    expect(clampTourStep(-2)).toBe(0);
    expect(clampTourStep(99)).toBe(OFFICE_TOUR_STEPS.length - 1);
    expect(clampTourStep(2.9)).toBe(2);
    expect(clampTourStep('x')).toBe(0);
  });
});

describe('office tour seen flag', () => {
  it('is unseen until marked', () => {
    const store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = String(v);
      },
    });
    expect(hasSeenOfficeTour()).toBe(false);
    markOfficeTourSeen();
    expect(store[OFFICE_TOUR_SEEN_KEY]).toBe('1');
    expect(hasSeenOfficeTour()).toBe(true);
  });

  it('does not nag if storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(hasSeenOfficeTour()).toBe(true);
    expect(() => markOfficeTourSeen()).not.toThrow();
  });
});
