/**
 * Push local server/uploads files to Render backend.
 *
 * Usage:
 *   node scripts/pushUploadsToRender.js
 *
 * Env (optional):
 *   RENDER_API_URL=https://raghunandan-academy-backend.onrender.com
 *   ADMIN_EMAIL=...
 *   ADMIN_PASSWORD=...
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = (process.env.RENDER_API_URL || 'https://raghunandan-academy-backend.onrender.com').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL || 'fastrecovery26@gmail.com';
const PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123456';
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep' || entry.name === '.sync-tmp') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else out.push({ full, relative: path.relative(base, full).replace(/\\/g, '/') });
  }
  return out;
}

async function login() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || `Login failed (${res.status})`);
  }
  const token = json?.data?.token;
  if (!token) throw new Error('Login succeeded but token missing');
  return token;
}

async function uploadOne(token, file) {
  const buf = fs.readFileSync(file.full);
  const form = new FormData();
  form.append('relativePath', file.relative);
  form.append('file', new Blob([buf]), path.basename(file.full));

  const res = await fetch(`${API_BASE}/api/admin/uploads/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || `Upload failed (${res.status}) for ${file.relative}`);
  }
  return json;
}

async function main() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    throw new Error(`Uploads folder not found: ${UPLOADS_DIR}`);
  }

  const files = walkFiles(UPLOADS_DIR);
  console.log(`API: ${API_BASE}`);
  console.log(`Found ${files.length} files to sync`);

  const token = await login();
  console.log('Admin login OK');

  let ok = 0;
  let fail = 0;
  for (const file of files) {
    try {
      await uploadOne(token, file);
      ok += 1;
      console.log(`OK  (${ok}/${files.length}) ${file.relative}`);
    } catch (err) {
      fail += 1;
      console.error(`FAIL ${file.relative}: ${err.message}`);
    }
  }

  console.log(`\nDone. success=${ok} failed=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
