import { describe, expect, it } from 'vitest';
import { imagePreviewZoomStyle, stepPreviewZoom } from './AvizPreviewZoomBar.jsx';

describe('imagePreviewZoomStyle', () => {
  it('fits the pane at 100%', () => {
    expect(imagePreviewZoomStyle(1)).toEqual({ width: '100%', maxWidth: '100%' });
  });

  it('uses zoom × pane width — not inverse width (75% must be smaller, not larger)', () => {
    expect(imagePreviewZoomStyle(0.75)).toEqual({ width: '75%', maxWidth: 'none' });
    expect(imagePreviewZoomStyle(2)).toEqual({ width: '200%', maxWidth: 'none' });
  });
});

describe('stepPreviewZoom', () => {
  it('steps within the ladder', () => {
    expect(stepPreviewZoom(1, -1)).toBe(0.75);
    expect(stepPreviewZoom(0.75, -1)).toBe(0.75);
    expect(stepPreviewZoom(1.5, 1)).toBe(2);
  });
});
