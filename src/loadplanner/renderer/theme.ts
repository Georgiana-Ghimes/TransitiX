/**
 * Visual tokens for the planner. Every colour the renderer uses comes from here, so a host
 * app can restyle the whole thing without touching a component.
 */
export type PlannerTheme = {
  free: string;
  freeStroke: string;
  occupied: string;
  occupiedStroke: string;
  selected: string;
  selectedStroke: string;
  warning: string;
  invalid: string;
  invalidStroke: string;
  chassis: string;
  cab: string;
  cabGlass: string;
  wall: string;
  floor: string;
  grid: string;
  axis: string;
  text: string;
  textMuted: string;
  /** Palette cycled per stop number. */
  stops: string[];
};

export const DEFAULT_THEME: PlannerTheme = {
  free: '#F1F5F9',
  freeStroke: '#CBD5E1',
  occupied: '#1D4E89',
  occupiedStroke: '#0A2B4E',
  selected: '#F5A623',
  selectedStroke: '#B8770F',
  warning: '#F5A623',
  invalid: '#C0392B',
  invalidStroke: '#7F1D1D',
  chassis: '#334155',
  cab: '#0A2B4E',
  cabGlass: '#7FB3E8',
  wall: '#0A2B4E',
  floor: '#FFFFFF',
  grid: '#E2E8F0',
  axis: '#94A3B8',
  text: '#16283C',
  textMuted: '#64748B',
  stops: ['#1D4E89', '#27AE60', '#E67E22', '#8E44AD', '#16A085', '#C0392B', '#2980B9', '#D97706'],
};

export function colorForStop(theme: PlannerTheme, stopNumber: number | undefined): string {
  if (stopNumber == null) return theme.occupied;
  const index = Math.abs(Math.trunc(stopNumber)) % theme.stops.length;
  return theme.stops[index];
}

/** Readable text colour for a filled shape. */
export function contrastText(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#FFFFFF';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Rec. 601 luma — good enough to pick black or white text.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? '#16283C' : '#FFFFFF';
}
