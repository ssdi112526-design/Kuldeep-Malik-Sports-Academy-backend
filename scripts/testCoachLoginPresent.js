/**
 * E2E: create coach → login → QR scan present → coach sees attendance
 * Usage: node scripts/testCoachLoginPresent.js
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const API = process.env.API_URL || 'http://localhost:5000/api';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'fastrecovery26@gmail.com').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123456';

const stamp = Date.now().toString().slice(-6);
const username = `coach_test_${stamp}`;
const password = 'Coach@Test1';
const aadhaar = String(900000000000 + Number(stamp)).slice(0, 12);
const pan = `CTEST${String(stamp).slice(-4)}A`; // AAAAA9999A pattern

function tinyJpeg() {
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
    'base64'
  );
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

async function main() {
  console.log('1) Admin login...');
  let res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  let data = await json(res);
  if (!res.ok) throw new Error(`Admin login failed: ${JSON.stringify(data)}`);
  const adminToken = data.data.token;
  console.log('   OK');

  const photoPath = path.join(process.cwd(), 'uploads', `_test_coach_${stamp}.jpg`);
  fs.mkdirSync(path.dirname(photoPath), { recursive: true });
  fs.writeFileSync(photoPath, tinyJpeg());

  console.log('2) Create coach', username, '...');
  const form = new FormData();
  form.append('fullName', `Test Coach ${stamp}`);
  form.append('fatherName', 'Test Father');
  form.append('mobile', `98${stamp}00`.replace(/\D/g, '').slice(0, 10).padEnd(10, '0'));
  form.append('email', `${username}@test.local`);
  form.append('dateOfBirth', '1990-01-15');
  form.append('aadhaarNumber', aadhaar);
  form.append('panNumber', pan);
  form.append('status', 'Active');
  form.append('specialization', 'Kushthi');
  form.append('loginUsername', username);
  form.append('password', password);
  form.append('confirmPassword', password);
  form.append('photo', new Blob([fs.readFileSync(photoPath)], { type: 'image/jpeg' }), 'coach.jpg');

  res = await fetch(`${API}/admin/coaches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  });
  data = await json(res);
  if (!res.ok) throw new Error(`Create coach failed: ${JSON.stringify(data)}`);
  const coach = data.data.coach;
  console.log('   OK', coach.coachCode, data.data.login);

  console.log('3) Coach login...');
  res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: username, password }),
  });
  data = await json(res);
  if (!res.ok) throw new Error(`Coach login failed: ${JSON.stringify(data)}`);
  const coachToken = data.data.token;
  const coachUser = data.data.user;
  console.log('   OK', {
    accountType: coachUser.accountType,
    isCoach: coachUser.isCoach,
    coachId: coachUser.coachId,
  });

  console.log('4) Coach profile + attendance (before)...');
  res = await fetch(`${API}/coach/profile`, { headers: { Authorization: `Bearer ${coachToken}` } });
  data = await json(res);
  if (!res.ok) throw new Error(`Coach profile failed: ${JSON.stringify(data)}`);
  console.log('   profile OK', data.data.coach.fullName);

  res = await fetch(`${API}/coach/attendance`, { headers: { Authorization: `Bearer ${coachToken}` } });
  data = await json(res);
  if (!res.ok) throw new Error(`Coach attendance failed: ${JSON.stringify(data)}`);
  console.log('   before:', data.data.summary);

  console.log('5) Admin generate coach QR + coach scan Present...');
  res = await fetch(`${API}/admin/coach-attendance/qr/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  data = await json(res);
  if (!res.ok) throw new Error(`Generate coach QR failed: ${JSON.stringify(data)}`);
  const session = data.data?.session;
  const payload = session?.qrPayload;
  if (!payload?.sessionId || !payload?.token) {
    throw new Error(`QR payload missing: ${JSON.stringify(data)}`);
  }

  res = await fetch(`${API}/coach/attendance/scan`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  data = await json(res);
  if (!res.ok) throw new Error(`Coach QR scan failed: ${JSON.stringify(data)}`);
  console.log('   marked OK via QR', data.message);

  console.log('6) Coach attendance (after)...');
  res = await fetch(`${API}/coach/attendance`, { headers: { Authorization: `Bearer ${coachToken}` } });
  data = await json(res);
  if (!res.ok) throw new Error(`Coach attendance after failed: ${JSON.stringify(data)}`);
  const summary = data.data.summary;
  const records = data.data.records || [];
  console.log('   after:', summary);
  console.log('   recent:', records.slice(0, 3));

  const presentOk = (summary.presentDays ?? summary.present ?? 0) >= 1 || records.some((r) => r.status === 'Present');
  if (!presentOk) throw new Error('Present not reflected in coach My Attendance');

  console.log('\nSUCCESS');
  console.log({ username, password, coachCode: coach.coachCode, coachId: coach.id });
  try {
    fs.unlinkSync(photoPath);
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
});
