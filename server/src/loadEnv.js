/**
 * Load server env once, before anything else reads process.env.
 *
 * Companion: set COMPANION=1 (or true) so `.env.companion` overrides `.env`
 * (isolated DB :5435, port 3002, Mistral key). Plain `.env` stays for Transitix full.
 *
 * `COMPANION=1` may live in the shell, in `.env`, or in `.env.companion` itself —
 * we peek the companion file so a VM that only has `.env.companion` still loads :5435.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, '.env');
const companion = path.join(root, '.env.companion');

function truthyFlag(raw) {
  return ['1', 'true', 'yes'].includes(String(raw || '').trim().toLowerCase());
}

dotenv.config({ path: base });

let companionWants = false;
if (fs.existsSync(companion)) {
  try {
    const peeked = dotenv.parse(fs.readFileSync(companion, 'utf8'));
    companionWants = truthyFlag(peeked.COMPANION);
  } catch {
    companionWants = false;
  }
}

const useCompanion = truthyFlag(process.env.COMPANION) || companionWants;
if (useCompanion && fs.existsSync(companion)) {
  dotenv.config({ path: companion, override: true });
  if (!process.env.COMPANION) process.env.COMPANION = '1';
}
