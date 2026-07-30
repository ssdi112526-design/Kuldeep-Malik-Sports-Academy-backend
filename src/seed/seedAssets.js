import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UPLOADS_DIR, toPublicPath } from '../middleware/upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENT_ASSETS = path.resolve(__dirname, '../../../client/src/assets/akhada');

/**
 * Copy a client asset into server/uploads (optional subfolder) and return public path.
 */
export async function copySeedImage(filename, subfolder = '') {
  const src = path.join(CLIENT_ASSETS, filename);
  const destDir = subfolder ? path.join(UPLOADS_DIR, subfolder) : UPLOADS_DIR;
  const destName = `seed-${filename}`;
  const dest = path.join(destDir, destName);

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    return toPublicPath(destName, subfolder);
  }

  console.warn(`Seed image missing: ${src}`);
  return toPublicPath(destName, subfolder);
}
