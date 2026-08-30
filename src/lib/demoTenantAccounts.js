/**
 * Published local QA logins — one office + one driver per product company.
 * Must stay unique globally (login is by email, not by company).
 * Keep in sync with server/src/seed.js → TENANT_DEMO_ACCOUNTS.
 */
export const DEMO_TENANT_ACCOUNTS = [
  {
    appKey: 'transitix_full',
    slug: 'txdemo7k2m',
    portalHint: '/txdemo7k2m',
    admin: { email: 'admin@transitix.ro', password: 'admin123', label: 'Admin TMS' },
    driver: { email: 'sofer@transitix.ro', password: 'sofer123', label: 'Șofer TMS' },
  },
  {
    appKey: 'rai_documents',
    slug: 'raidocs4n9p',
    portalHint: '/raidocs4n9p',
    admin: { email: 'admin@rai-spedition.ro', password: 'admin123', label: 'Admin RAI' },
    driver: { email: 'sofer@rai-spedition.ro', password: 'sofer123', label: 'Șofer RAI' },
  },
];

export function demoAccountsForAppKey(appKey) {
  return DEMO_TENANT_ACCOUNTS.find((t) => t.appKey === appKey) || null;
}
