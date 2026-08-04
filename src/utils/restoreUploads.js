/**
 * Restore media files from seed-media/ into uploads/ when missing.
 * Render free disk is ephemeral — redeploy wipes /uploads but DB rows remain.
 * Committing seed-media keeps website/student photos recoverable on boot.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UPLOADS_DIR } from '../middleware/upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SEED_MEDIA_DIR = path.resolve(__dirname, '../../seed-media');

function walkFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep' || entry.name === '.DS_Store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else out.push({ full, relative: path.relative(base, full).replace(/\\/g, '/') });
  }
  return out;
}

export function restoreUploadsFromSeedMedia() {
  if (!fs.existsSync(SEED_MEDIA_DIR)) {
    console.warn('[uploads] seed-media folder missing — skip restore');
    return { restored: 0, skipped: 0, total: 0 };
  }

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const files = walkFiles(SEED_MEDIA_DIR);
  let restored = 0;
  let skipped = 0;

  for (const file of files) {
    const dest = path.join(UPLOADS_DIR, file.relative);
    if (fs.existsSync(dest)) {
      skipped += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file.full, dest);
    restored += 1;
  }

  if (restored > 0) {
    console.log(`[uploads] Restored ${restored} missing file(s) from seed-media (${skipped} already present)`);
  } else {
    console.log(`[uploads] seed-media check OK — ${skipped} file(s) already present`);
  }

  return { restored, skipped, total: files.length };
}
