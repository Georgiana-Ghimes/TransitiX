import './loadEnv.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// loadEnv runs first: ES imports evaluate before the entrypoint, so UPLOAD_DIR must
// already be on process.env when this module computes uploadRoot.
/**
 * Always the same path for multer and for the static handler.
 *
 * `UPLOAD_DIR` overrides it so the route tests write into a throwaway directory. Without that
 * they scatter fixture files through a developer's real uploads folder, where they sit forever
 * with nothing in the database pointing at them.
 */
export const uploadRoot = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../uploads');

fs.mkdirSync(uploadRoot, { recursive: true });

export function publicUploadUrl(filename) {
  return `/uploads/${filename}`;
}
