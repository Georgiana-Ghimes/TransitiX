/**
 * RAI client login accounts (office + driver placeholder).
 * Used by `scripts/ensure-stefan-accounts.js` — keep emails stable across local / VM / prod.
 */
export const STEFAN_ACCOUNTS = [
  {
    key: 'stefan',
    email: 'stefan@transitix.ro',
    name: 'Stefan',
    role: 'admin',
    passwordEnv: 'STEFAN_PASSWORD',
    driver: false,
  },
  {
    key: 'sofer-stefan',
    email: 'sofer-stefan@transitix.ro',
    name: 'Șofer',
    role: 'driver',
    passwordEnv: 'SOFER_STEFAN_PASSWORD',
    /** Placeholder until the real name is known — drivers.name is NOT NULL. */
    driverName: 'Șofer',
    driver: true,
  },
];
