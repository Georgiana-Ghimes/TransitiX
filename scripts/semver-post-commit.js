import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bumpSemver, classifyBump, shouldSkipVersion } from './semverBump.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitDir = path.join(root, '.git');

function git(args, opts = {}) {
  return execSync(`git ${args}`, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).trim();
}

function inProgress() {
  return (
    fs.existsSync(path.join(gitDir, 'MERGE_HEAD')) ||
    fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
    fs.existsSync(path.join(gitDir, 'rebase-apply')) ||
    fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))
  );
}

function readPkgVersion(rel) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  return pkg.version;
}

function writePkgVersion(rel, version) {
  const file = path.join(root, rel);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

function alreadyBumped() {
  let parent;
  try {
    parent = git('rev-parse HEAD^');
  } catch {
    return false;
  }
  try {
    const prev = JSON.parse(git(`show ${parent}:package.json`)).version;
    const now = readPkgVersion('package.json');
    return prev !== now;
  } catch {
    return false;
  }
}

if (process.env.SKIP_VERSION_HOOK === '1') process.exit(0);
if (process.env.GIT_EDITOR === ':') process.exit(0);
if (!fs.existsSync(gitDir) || inProgress()) process.exit(0);

const message = git('log -1 --format=%B');
if (shouldSkipVersion(message)) process.exit(0);
if (alreadyBumped()) process.exit(0);

const bump = classifyBump(message) || 'patch';
const next = bumpSemver(readPkgVersion('package.json'), bump);
writePkgVersion('package.json', next);
writePkgVersion('server/package.json', next);

git('add package.json server/package.json');
execSync('git commit --amend --no-edit --no-verify', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SKIP_VERSION_HOOK: '1' },
});

console.log(`Transitix version → ${next} (${bump})`);
