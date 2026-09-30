/**
 * Shared Tailwind class tokens for the driver app at large system text / display size.
 * Prefer these over ad-hoc text-[10px] / min-h-[44px] so 150–200% zoom stays usable.
 */

export const DRIVER_SHELL =
  'w-full max-w-[28rem] sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl mx-auto';

/** Text / select fields — 56px min height, base type. */
export const driverFieldCls =
  'w-full min-h-14 px-4 py-3 text-base border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#1D4E89]';

export const driverLabelCls = 'mb-1.5 block text-base font-medium text-slate-600';

/** Primary full-width action (confirm, send, camera). */
export const driverPrimaryBtn =
  'inline-flex w-full min-h-14 items-center justify-center gap-2 rounded-xl bg-[#0A2B4E] px-4 text-base font-semibold text-white active:scale-[0.99] disabled:opacity-50';

/** Secondary full-width (cancel, gallery, outline). */
export const driverSecondaryBtn =
  'inline-flex w-full min-h-14 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-[#0A2B4E] active:scale-[0.99] disabled:opacity-50';

export const driverDangerBtn =
  'inline-flex w-full min-h-14 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 text-base font-semibold text-white hover:bg-red-600 active:bg-red-700 disabled:opacity-60';

/** Bottom-nav tab button. */
export const driverNavBtn =
  'relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2';

export const driverNavLabel =
  'max-w-full whitespace-normal px-0.5 text-center text-xs font-medium leading-tight';

export const driverNavIcon = 'h-6 w-6 shrink-0';

/** Space for taller bottom nav + home indicator. */
export const DRIVER_MAIN_PAD_BOTTOM = 'calc(7rem + env(safe-area-inset-bottom))';

export const driverStackGap = 'space-y-4';
