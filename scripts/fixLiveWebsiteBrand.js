/**
 * Patch live/production site-settings company + about to Kuldeep Malik Sports Academy.
 *
 * Usage:
 *   node scripts/fixLiveWebsiteBrand.js
 *
 * Env (optional):
 *   RENDER_API_URL=https://raghunandan-akhada-backend.onrender.com
 *   ADMIN_EMAIL=...
 *   ADMIN_PASSWORD=...
 */
import dotenv from 'dotenv';
import { DEFAULT_WEBSITE_SETTINGS } from '../src/seed/seedCmsDefaults.js';

dotenv.config();

const API_BASE = (
  process.env.RENDER_API_URL || 'https://raghunandan-akhada-backend.onrender.com'
).replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL || 'fastrecovery26@gmail.com';
const PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123456';

async function login() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Login failed (${res.status})`);
  const token = json?.data?.token;
  if (!token) throw new Error('Login succeeded but token missing');
  return token;
}

async function main() {
  console.log(`API: ${API_BASE}`);
  const token = await login();

  const getRes = await fetch(`${API_BASE}/api/admin/site-settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const getJson = await getRes.json().catch(() => ({}));
  if (!getRes.ok) throw new Error(getJson.message || `GET site-settings failed (${getRes.status})`);

  const current = getJson?.data?.siteSettings?.value || getJson?.data?.value || {};
  const next = {
    ...current,
    company: {
      ...(current.company || {}),
      ...DEFAULT_WEBSITE_SETTINGS.company,
    },
    about: {
      ...(current.about || {}),
      ...DEFAULT_WEBSITE_SETTINGS.about,
      image: current.about?.image ?? DEFAULT_WEBSITE_SETTINGS.about.image,
    },
    hero: {
      ...(current.hero || {}),
      ...DEFAULT_WEBSITE_SETTINGS.hero,
      image: current.hero?.image ?? DEFAULT_WEBSITE_SETTINGS.hero.image,
    },
    social: Array.isArray(current.social) && current.social.length
      ? current.social
      : DEFAULT_WEBSITE_SETTINGS.social,
  };

  const form = new FormData();
  form.append('value', JSON.stringify(next));

  const putRes = await fetch(`${API_BASE}/api/admin/site-settings`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const putJson = await putRes.json().catch(() => ({}));
  if (!putRes.ok) throw new Error(putJson.message || `PUT site-settings failed (${putRes.status})`);

  console.log('Updated company:', next.company);
  console.log('Done — live site-settings now use Kuldeep Malik Sports Academy branding.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
