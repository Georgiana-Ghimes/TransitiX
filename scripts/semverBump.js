/**
 * SemVer bump from conventional-commit messages (Transitix AGENTS.md):
 * major — breaking API/schema
 * minor — user-visible features (feat)
 * patch — fixes, docs, tooling
 */

const SKIP_RE = /\[skip version\]|\[skip-version\]/i;
const BUMP_COMMIT_RE = /^chore:\s*(bump version|release)\b/i;

export function shouldSkipVersion(message) {
  const text = String(message || '');
  return SKIP_RE.test(text) || BUMP_COMMIT_RE.test(text);
}

export function classifyBump(message) {
  const text = String(message || '');
  if (shouldSkipVersion(text)) return null;

  const subject = text.split('\n')[0] || '';
  const breaking =
    /^[a-z]+(?:\([^)]+\))?!:/i.test(subject) ||
    /^breaking change\b/im.test(text) ||
    /\bbreaking\s+api\b/i.test(text) ||
    /\bbreaking\s+schema\b/i.test(text);
  if (breaking) return 'major';

  if (/^feat(\([^)]+\))?:/i.test(subject)) return 'minor';
  return 'patch';
}

export function highestBump(messages) {
  let rank = 0;
  let bump = null;
  const rankOf = { patch: 1, minor: 2, major: 3 };
  for (const message of messages) {
    const next = classifyBump(message);
    if (!next) continue;
    if (rankOf[next] > rank) {
      rank = rankOf[next];
      bump = next;
    }
  }
  return bump;
}

export function bumpSemver(version, bump) {
  const match = String(version || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Invalid semver: ${version}`);
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (bump === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}
