import dotenv from 'dotenv';
dotenv.config();

const email = process.env.ADMIN_EMAIL || 'fastrecovery26@gmail.com';
const password = process.env.ADMIN_PASSWORD || 'Admin@123456';
const base = process.env.API_BASE || 'http://127.0.0.1:5000';

const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const json = await res.json().catch(() => ({}));
console.log(JSON.stringify({
  httpStatus: res.status,
  success: json.success,
  message: json.message,
  role: json?.data?.user?.roleSlug || json?.data?.user?.role,
  permissionsCount: json?.data?.permissions?.length ?? json?.data?.user?.permissions?.length,
  hasToken: Boolean(json?.data?.token),
}, null, 2));
if (!res.ok) process.exit(1);
