/**
 * Bumps the version in both package.json files at once.
 *
 * The post-commit hook already does this from the commit message, but it only runs on a commit.
 * Work done and reviewed before committing still has to show the right version — the sidebar
 * reads `package.json` directly — and the two files must never drift apart: the UI reads the root
 * one, the API reports the server one, and a mismatch turns "which version is this?" into a
 * question with two answers.
 *
 *   node scripts/bump-version.js minor
 *   node scripts/bump-version.js 1.14.0
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bumpSemver } from './semverBump.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['package.json', 'server/package.json'];

function read(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function write(rel, version) {
  const file = path.join(root, rel);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

const arg = process.argv[2];
if (!arg) {
  console.error('Folosire: node scripts/bump-version.js <major|minor|patch|1.2.3>');
  process.exit(1);
}

const current = read('package.json').version;
const next = /^\d+\.\d+\.\d+$/.test(arg) ? arg : bumpSemver(current, arg);

// Both files or neither: a half-applied bump is worse than none.
const drifted = FILES.map((f) => [f, read(f).version]).filter(([, v]) => v !== current);
if (drifted.length) {
  console.warn(`Atenție: versiunile erau desincronizate (${drifted.map(([f, v]) => `${f}=${v}`).join(', ')}).`);
}

for (const file of FILES) write(file, next);
console.log(`${current} → ${next}`);
