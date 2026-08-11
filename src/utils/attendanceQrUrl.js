/**
 * Public website origin for attendance QR links (phone camera opens URL, not raw JSON).
 */
export function getPublicWebOrigin() {
  const explicit = (process.env.CLIENT_PUBLIC_URL || process.env.PUBLIC_WEB_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const list = String(process.env.CLIENT_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const preferred = list.find((u) => /kushti\.co\.in/i.test(u) && /^https:\/\//i.test(u));
  const legacy = list.find((u) => /fastsearch\.in/i.test(u) && /^https:\/\//i.test(u));
  const https = list.find((u) => /^https:\/\//i.test(u));
  return (preferred || legacy || https || list[0] || 'https://www.kushti.co.in').replace(/\/$/, '');
}

export function encodeAttendanceQrContent(payload) {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json, 'utf8').toString('base64url');
  return `${getPublicWebOrigin()}/attendance/scan?data=${data}`;
}
