/**
 * Finance module API smoke test (manual fees — no payment gateway).
 * Usage: node scripts/testFinanceApi.js
 */
import 'dotenv/config';

const BASE = process.env.API_BASE || `http://127.0.0.1:${process.env.PORT || 5000}/api`;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

const results = [];

function ok(name, detail = '') {
  results.push({ name, pass: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, pass: false, detail });
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, path, { token, body, raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof Buffer)) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body == null ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (raw) {
    data = Buffer.from(await res.arrayBuffer());
  } else if (ct.includes('json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, data, ct };
}

async function main() {
  if (!email || !password) {
    console.error('ADMIN_EMAIL / ADMIN_PASSWORD missing in .env');
    process.exit(1);
  }

  console.log(`Testing Finance API at ${BASE}\n`);

  // 1. Login
  let token;
  {
    const res = await req('POST', '/auth/login', { body: { login: email, password } });
    if (res.status === 200 && res.data?.data?.token) {
      token = res.data.data.token;
      ok('Login', `user=${res.data.data.user?.email || res.data.data.user?.name}`);
    } else if (res.status === 200 && res.data?.token) {
      token = res.data.token;
      ok('Login');
    } else {
      // try alternate shape
      token = res.data?.data?.accessToken || res.data?.accessToken;
      if (token) ok('Login', 'alt token shape');
      else {
        fail('Login', `${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
        process.exit(1);
      }
    }
  }

  // 2. Dashboard
  {
    const res = await req('GET', '/admin/finance/dashboard', { token });
    if (res.status === 200 && res.data?.success) ok('Finance Dashboard', `pending=${res.data.data?.studentFees?.totalPending}`);
    else fail('Finance Dashboard', `${res.status} ${JSON.stringify(res.data).slice(0, 240)}`);
  }

  // 3. Student fees list
  let studentId = null;
  {
    const res = await req('GET', '/admin/finance/students?page=1&limit=5', { token });
    if (res.status === 200 && res.data?.success) {
      const rows = res.data.data?.rows || [];
      studentId = rows[0]?.id;
      ok('Student Fees list', `rows=${rows.length} total=${res.data.data?.total}`);
    } else fail('Student Fees list', `${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
  }

  // 4. Update fee defaults
  if (studentId) {
    const res = await req('PATCH', `/admin/finance/students/${studentId}/defaults`, {
      token,
      body: { monthlyFee: 2000, admissionFee: 500, defaultDiscount: 0 },
    });
    if (res.status === 200 && res.data?.success) ok('Update student fee defaults', 'monthlyFee=2000');
    else fail('Update student fee defaults', `${res.status} ${JSON.stringify(res.data).slice(0, 240)}`);
  } else fail('Update student fee defaults', 'no student');

  // 5. Search
  if (studentId) {
    const res = await req('GET', '/admin/finance/students/search?q=AKH', { token });
    if (res.status === 200 && res.data?.success) ok('Student search', `hits=${(res.data.data?.students || []).length}`);
    else fail('Student search', `${res.status}`);
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // 6. Generate monthly (create or replace same month)
  {
    const res = await req('POST', '/admin/finance/generate-monthly', {
      token,
      body: { month, year },
    });
    if (res.status === 200 && res.data?.success) {
      ok(
        'Generate monthly fees',
        `created=${res.data.data?.created} updated=${res.data.data?.updated} cleared=${res.data.data?.paymentsCleared}`
      );
    } else fail('Generate monthly fees', `${res.status} ${JSON.stringify(res.data).slice(0, 240)}`);
  }

  // 7. Collect preview
  if (studentId) {
    const res = await req(
      'GET',
      `/admin/finance/collect/preview?studentId=${studentId}&month=${month}&year=${year}`,
      { token }
    );
    if (res.status === 200 && res.data?.success) ok('Collect preview', `outstanding=${res.data.data?.totalOutstanding}`);
    else fail('Collect preview', `${res.status} ${JSON.stringify(res.data).slice(0, 240)}`);
  }

  // 8. Collect fee (partial then check)
  let paymentId = null;
  let receiptNumber = null;
  if (studentId) {
    const res = await req('POST', '/admin/finance/collect', {
      token,
      body: {
        studentId,
        month,
        year,
        feeAmount: 2000,
        discount: 0,
        paidAmount: 1000,
        paymentMode: 'Cash',
        paymentDate: now.toISOString().slice(0, 10),
        remarks: 'API smoke test partial',
      },
    });
    if ((res.status === 200 || res.status === 201) && res.data?.success) {
      paymentId = res.data.data?.payment?.id;
      receiptNumber = res.data.data?.payment?.receiptNumber;
      ok('Collect fee (partial 1000)', `receipt=${receiptNumber}`);
    } else fail('Collect fee (partial 1000)', `${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
  }

  // 9. Duplicate month generate should skip
  {
    const res = await req('POST', '/admin/finance/generate-monthly', {
      token,
      body: { month, year, studentIds: studentId ? [studentId] : [] },
    });
    if (res.status === 200 && res.data?.data?.skipped >= 0) ok('Duplicate month prevention', `skipped=${res.data.data.skipped}`);
    else fail('Duplicate month prevention', `${res.status}`);
  }

  // 10. Pending fees
  {
    const res = await req('GET', '/admin/finance/pending?page=1&limit=10', { token });
    if (res.status === 200 && res.data?.success) ok('Pending fees', `rows=${res.data.data?.rows?.length}`);
    else fail('Pending fees', `${res.status}`);
  }

  // 11. History
  if (studentId) {
    const res = await req('GET', `/admin/finance/students/${studentId}/history`, { token });
    if (res.status === 200 && res.data?.success) ok('Student fee history', `months=${res.data.data?.history?.length}`);
    else fail('Student fee history', `${res.status}`);
  }

  // 12. Payment history + receipt
  {
    const res = await req('GET', '/admin/finance/payments?page=1&limit=10', { token });
    if (res.status === 200 && res.data?.success) ok('Payment history', `rows=${res.data.data?.rows?.length}`);
    else fail('Payment history', `${res.status}`);
  }
  if (paymentId) {
    const res = await req('GET', `/admin/finance/payments/${paymentId}`, { token });
    if (res.status === 200 && res.data?.data?.payment?.receiptNumber) {
      ok('View receipt', res.data.data.payment.receiptNumber);
    } else fail('View receipt', `${res.status}`);
  }

  // 13. Update payment
  if (paymentId) {
    const res = await req('PUT', `/admin/finance/payments/${paymentId}`, {
      token,
      body: { remarks: 'API smoke test updated', amount: 1000 },
    });
    if (res.status === 200 && res.data?.success) ok('Edit payment');
    else fail('Edit payment', `${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
  }

  // 14. Coach payment
  let coachId = null;
  let coachPaymentId = null;
  {
    const res = await req('GET', '/admin/coaches?page=1&limit=5&status=Active', { token });
    const rows = res.data?.data?.coaches || res.data?.data?.rows || res.data?.data?.items || [];
    coachId = rows[0]?.id || rows[0]?._id;
    if (coachId) ok('Load coaches for payment', coachId.slice(0, 8));
    else fail('Load coaches for payment', `${res.status} keys=${Object.keys(res.data?.data || {}).join(',')}`);
  }
  if (coachId) {
    const res = await req('POST', '/admin/finance/coach-payments', {
      token,
      body: {
        coachId,
        month,
        year,
        baseSalary: 15000,
        bonus: 2000,
        deduction: 1000,
        paidAmount: 16000,
        paymentMode: 'UPI',
        paymentDate: now.toISOString().slice(0, 10),
        remarks: 'API smoke test coach',
      },
    });
    if ((res.status === 200 || res.status === 201) && res.data?.success) {
      coachPaymentId = res.data.data?.payment?.id;
      const p = res.data.data?.payment;
      const netOk = Number(p?.netPayable) === 16000;
      ok('Coach payment (salary+bonus-deduction)', `net=${p?.netPayable} paid=${p?.paidAmount} status=${p?.status} calc=${netOk}`);
      if (!netOk) fail('Coach net calculation', `expected 16000 got ${p?.netPayable}`);
    } else fail('Coach payment', `${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
  }

  // 15. Coach list
  {
    const res = await req('GET', '/admin/finance/coach-payments?page=1&limit=10', { token });
    if (res.status === 200 && res.data?.success) ok('Coach payment history', `rows=${res.data.data?.rows?.length}`);
    else fail('Coach payment history', `${res.status}`);
  }

  // 16. Reports
  {
    const res = await req('GET', `/admin/finance/report?month=${month}&year=${year}`, { token });
    if (res.status === 200 && res.data?.success) {
      ok('Finance report', `collected=${res.data.data?.totalStudentFeesCollected} net=${res.data.data?.netBalance}`);
    } else fail('Finance report', `${res.status}`);
  }

  // 17. Exports
  for (const [name, path] of [
    ['Export student payments xlsx', '/admin/finance/export/payments'],
    ['Export pending csv', '/admin/finance/export/pending'],
    ['Export coach payments xlsx', '/admin/finance/export/coach-payments'],
  ]) {
    const format = name.includes('csv') ? 'csv' : 'xlsx';
    const res = await req('POST', path, { token, body: { format, month, year }, raw: true });
    if (res.status === 200 && res.data?.length > 50) ok(name, `bytes=${res.data.length}`);
    else fail(name, `status=${res.status} bytes=${res.data?.length}`);
  }

  // 18. Soft delete payment (cleanup test payment)
  if (paymentId) {
    const res = await req('DELETE', `/admin/finance/payments/${paymentId}`, { token });
    if (res.status === 200 && res.data?.success) ok('Soft-delete student payment');
    else fail('Soft-delete student payment', `${res.status}`);
  }

  // 19. Negative / validation
  {
    const res = await req('POST', '/admin/finance/collect', {
      token,
      body: {
        studentId,
        month,
        year,
        feeAmount: 2000,
        paidAmount: -50,
        paymentMode: 'Cash',
      },
    });
    if (res.status >= 400) ok('Reject negative payment', `status=${res.status}`);
    else fail('Reject negative payment', 'accepted invalid amount');
  }
  {
    const res = await req('POST', '/admin/finance/collect', {
      token,
      body: {
        studentId,
        month,
        year,
        feeAmount: 2000,
        paidAmount: 100,
        paymentMode: 'Bitcoin',
      },
    });
    if (res.status >= 400) ok('Reject invalid payment mode', `status=${res.status}`);
    else fail('Reject invalid payment mode', 'accepted Bitcoin');
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n——————\n${passed} passed, ${failed} failed (total ${results.length})`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
