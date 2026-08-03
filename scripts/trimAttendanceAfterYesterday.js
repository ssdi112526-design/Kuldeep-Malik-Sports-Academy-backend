/**
 * Keep attendance only through yesterday (Asia/Kolkata).
 * Deletes attendance with date >= today, plus orphaned demo sessions for those rows.
 * Does NOT touch ACTIVE live QR sessions.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function todayIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const today = todayIST();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const toDelete = await prisma.attendance.findMany({
    where: { date: { gte: today } },
    select: { id: true, date: true, source: true, attendanceSessionId: true },
  });

  const sessionIds = [...new Set(toDelete.map((r) => r.attendanceSessionId))];

  const delAtt = await prisma.attendance.deleteMany({
    where: { date: { gte: today } },
  });

  // Remove demo sessions that belonged to deleted attendance (never touch ACTIVE live QR)
  let delSess = { count: 0 };
  if (sessionIds.length) {
    delSess = await prisma.attendanceSession.deleteMany({
      where: {
        id: { in: sessionIds },
        status: { not: 'ACTIVE' },
        OR: [{ source: 'demo' }, { sessionCode: { startsWith: 'DEMO-ATT-' } }],
      },
    });
  }

  const remainingThisMonth = await prisma.attendance.count({
    where: {
      date: {
        gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
        lte: yesterday,
      },
    },
  });

  console.log(`Today (IST): ${dateKey(today)}`);
  console.log(`Keep through: ${dateKey(yesterday)}`);
  console.log(`Deleted attendance rows: ${delAtt.count}`);
  console.log(`Deleted demo sessions: ${delSess.count}`);
  console.log(`This month remaining (through yesterday): ${remainingThisMonth}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
