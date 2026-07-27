import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Always resolve to server/uploads — same path for multer + static */
export const uploadRoot = path.resolve(__dirname, '../uploads');

fs.mkdirSync(uploadRoot, { recursive: true });

export function publicUploadUrl(filename) {
  return `/uploads/${filename}`;
}
