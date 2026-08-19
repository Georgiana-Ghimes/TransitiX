import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, '.githooks');
const destDir = path.join(root, '.git', 'hooks');

if (!fs.existsSync(path.join(root, '.git'))) {
  process.exit(0);
}
if (!fs.existsSync(srcDir) || !fs.existsSync(destDir)) {
  process.exit(0);
}

for (const name of fs.readdirSync(srcDir)) {
  const src = path.join(srcDir, name);
  if (!fs.statSync(src).isFile()) continue;
  const dest = path.join(destDir, name);
  fs.copyFileSync(src, dest);
  try {
    fs.chmodSync(dest, 0o755);
  } catch {
    // Windows may ignore chmod
  }
}
