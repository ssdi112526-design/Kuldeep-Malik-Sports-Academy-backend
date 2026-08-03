import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Fast demo attendance seed — safe to re-run.
 * source="demo" + session codes DEMO-ATT-* so live QR is never touched.
 *
 * npm run seed:attendance-demo
 * npm run seed:attendance-demo:reset
 */

const DEMO_SOURCE = 'demo';
const DEMO_REG_PREFIX = 'DEMO-2026-';
const ATTENDANCE_RATES = [0.9, 0.82, 0.95, 0.7, 0.88, 0.78, 0.92, 0.85];
const MONTHS = [
  { year: 2026, month: 1 },
  { year: 2026, month: 2 },
  { year: 2026, month: 3 },
  { year: 2026, month: 4 },
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
  { year: 2026, month: 7 },
  { year: 2026, month: 8 },
];

function assertDemoAllowed() {
  const env = process.env.NODE_ENV || 'development';
  const allow = process.env.ALLOW_DEMO_SEED === 'true' || env !== 'production';
  if (!allow) {
    throw new Error('Demo attendance seed blocked. Set ALLOW_DEMO_SEED=true to run in production.');
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function trainingDaysInMonth(year, month) {
  const days = [];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let d = 1; d <= last; d += 1) {
    const date = new Date(Date.UTC(year, month - 1, d));
    if (date.getUTCDay() === 0) continue;
    days.push(date);
  }
  return days;
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function markedAtFor(date, index) {
  const base = new Date(date);
  base.setUTCHours(0, 40 + index, (index * 7) % 60, 0);
  return base;
}

async function ensureDemoStudents(existingActive) {
  // Prefer real students when enough exist — do not create DEMO students unnecessarily.
  if (existingActive.length >= 5) {
    return existingActive.slice(0, 8);
  }

  const students = [...existingActive];
  for (let i = 1; i <= 5 && students.length < 5; i += 1) {
    const reg = `${DEMO_REG_PREFIX}${String(i).padStart(4, '0')}`;
    let student = await prisma.student.findUnique({ where: { registrationNumber: reg } });
    if (!student) {
      const aadhaar = `9000000000${String(i).padStart(2, '0')}`;
      const pan = `DEMOS${String(1000 + i).slice(-4)}X`;
      student = await prisma.student.create({
        data: {
          registrationNumber: reg,
          fullName: `Demo Student ${String(i).padStart(2, '0')}`,
          fatherName: 'Demo Father',
          motherName: 'Demo Mother',
          gender: 'Other',
          dateOfBirth: new Date('2005-01-15T00:00:00.000Z'),
          mobileNumber: `90000000${String(i).padStart(2, '0')}`,
          email: `demo.student${i}@demo.akhada.local`,
          aadhaarNumber: aadhaar.slice(0, 12),
          panNumber: pan.slice(0, 10),
          joiningDate: new Date('2026-01-01T00:00:00.000Z'),
          membershipType: 'Demo',
          batch: 'Morning',
          trainingLevel: 'Beginner',
          status: 'Active',
          paymentStatus: 'Pending',
          address: 'Demo Address — Not Real',
          city: 'Demo City',
          state: 'Demo State',
        },
      });
      await prisma.studentDocument.create({ data: { studentId: student.id } });
    }
    if (!students.find((s) => s.id === student.id)) students.push(student);
  }
  return students.slice(0, 8);
}

async function resetDemo() {
  assertDemoAllowed();
  const sessions = await prisma.attendanceSession.findMany({
    where: { OR: [{ source: DEMO_SOURCE }, { sessionCode: { startsWith: 'DEMO-ATT-' } }] },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);
  const delAtt = await prisma.attendance.deleteMany({
    where: {
      OR: [{ source: DEMO_SOURCE }, { attendanceSessionId: { in: sessionIds.length ? sessionIds : ['__none__'] } }],
    },
  });
  const delSess = await prisma.attendanceSession.deleteMany({
    where: { id: { in: sessionIds.length ? sessionIds : ['__none__'] } },
  });

  const demoStudents = await prisma.student.findMany({
    where: { registrationNumber: { startsWith: DEMO_REG_PREFIX } },
    select: { id: true },
  });
  let removedStudents = 0;
  for (const s of demoStudents) {
    const left = await prisma.attendance.count({ where: { studentId: s.id } });
    if (left === 0) {
      await prisma.user.deleteMany({ where: { studentId: s.id } });
      await prisma.student.delete({ where: { id: s.id } });
      removedStudents += 1;
    }
  }

  console.log('Demo attendance reset complete.');
  console.log(`Deleted attendance: ${delAtt.count}`);
  console.log(`Deleted sessions: ${delSess.count}`);
  console.log(`Removed demo students: ${removedStudents}`);
}

async function seedDemo() {
  assertDemoAllowed();

  const existingDemoSessions = await prisma.attendanceSession.count({
    where: { OR: [{ source: DEMO_SOURCE }, { sessionCode: { startsWith: 'DEMO-ATT-' } }] },
  });
  if (existingDemoSessions > 0) {
    const existingDemoAtt = await prisma.attendance.count({
      where: { OR: [{ source: DEMO_SOURCE }, { session: { sessionCode: { startsWith: 'DEMO-ATT-' } } }] },
    });
    console.log('Demo attendance already present — skipping insert (safe re-run).');
    console.log(`Existing demo sessions: ${existingDemoSessions}`);
    console.log(`Existing demo attendance records: ${existingDemoAtt}`);
    console.log('Existing real records: Preserved');
    console.log('Duplicate demo records: 0');
    return;
  }

  const existingActive = await prisma.student.findMany({
    where: { status: 'Active', NOT: { registrationNumber: { startsWith: DEMO_REG_PREFIX } } },
    orderBy: { registrationNumber: 'asc' },
    take: 8,
  });
  const students = await ensureDemoStudents(existingActive);

  const sessionRows = [];
  const attendancePlan = []; // { sessionCode, student, day, markedAt }

  for (const { year, month } of MONTHS) {
    const days = trainingDaysInMonth(year, month);
    for (const day of days) {
      const ymd = dateKey(day).replace(/-/g, '');
      let seq = 0;
      for (let si = 0; si < students.length; si += 1) {
        const student = students[si];
        const rate = ATTENDANCE_RATES[si % ATTENDANCE_RATES.length];
        const hash = crypto.createHash('sha256').update(`${ymd}:${student.registrationNumber}`).digest()[0];
        if (hash / 255 >= rate) continue;

        seq += 1;
        const sessionCode = `DEMO-ATT-${ymd}-${String(seq).padStart(3, '0')}`;
        const rawToken = crypto.createHash('sha256').update(`demo-token:${sessionCode}`).digest('hex');
        const markedAt = markedAtFor(day, seq);
        const id = crypto.randomUUID();

        sessionRows.push({
          id,
          sessionCode,
          tokenHash: hashToken(rawToken),
          displayToken: null,
          status: 'USED',
          source: DEMO_SOURCE,
          expiresAt: markedAt,
          usedAt: markedAt,
          usedByStudentId: student.id,
          closedAt: markedAt,
        });
        attendancePlan.push({
          sessionId: id,
          student,
          day,
          markedAt,
        });
      }
    }
  }

  console.log(`Preparing ${sessionRows.length} demo sessions…`);
  const CHUNK = 100;
  for (let i = 0; i < sessionRows.length; i += CHUNK) {
    await prisma.attendanceSession.createMany({
      data: sessionRows.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    process.stdout.write(`\rSessions: ${Math.min(i + CHUNK, sessionRows.length)}/${sessionRows.length}`);
  }
  console.log('');

  const attendanceRows = attendancePlan.map((p) => ({
    studentId: p.student.id,
    attendanceSessionId: p.sessionId,
    registrationId: p.student.registrationNumber,
    date: p.day,
    markedAt: p.markedAt,
    status: 'present',
    source: DEMO_SOURCE,
  }));

  console.log(`Preparing ${attendanceRows.length} attendance records…`);
  for (let i = 0; i < attendanceRows.length; i += CHUNK) {
    await prisma.attendance.createMany({
      data: attendanceRows.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    process.stdout.write(`\rAttendance: ${Math.min(i + CHUNK, attendanceRows.length)}/${attendanceRows.length}`);
  }
  console.log('');

  for (const student of students) {
    const present = await prisma.attendance.count({
      where: { studentId: student.id, status: 'present' },
    });
    await prisma.student.update({
      where: { id: student.id },
      data: {
        attendancePresent: present,
        attendanceTotal: present,
        attendanceAbsent: 0,
      },
    });
  }

  console.log('Demo attendance seed completed.');
  console.log(`Students used: ${students.length}`);
  console.log('Months: January 2026 → August 2026');
  console.log(`Demo sessions: ${sessionRows.length}`);
  console.log(`Attendance records: ${attendanceRows.length}`);
  console.log('Existing records: Preserved');
  console.log('Duplicate demo records: 0');
}

async function main() {
  const mode = process.argv[2] || 'seed';
  if (mode === 'reset') await resetDemo();
  else {
    // Clear partial failed seed first if any sessions exist but incomplete — handled by skip if any exist
    await seedDemo();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
