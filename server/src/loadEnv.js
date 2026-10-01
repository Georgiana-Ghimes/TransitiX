/**
 * Load server env once, before anything else reads process.env.
 *
 * Companion: set COMPANION=1 (or true) so `.env.companion` overrides `.env`
 * (isolated DB :5435, port 3002, Mistral key). Plain `.env` stays for Transitix full.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, '.env');
const companion = path.join(root, '.env.companion');

dotenv.config({ path: base });

const useCompanion = ['1', 'true', 'yes'].includes(
  String(process.env.COMPANION || '').trim().toLowerCase(),
);
if (useCompanion && fs.existsSync(companion)) {
  dotenv.config({ path: companion, override: true });
}
