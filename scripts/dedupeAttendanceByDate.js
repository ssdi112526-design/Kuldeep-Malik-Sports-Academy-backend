/**
 * Safe duplicate cleanup: keep earliest attendance per (studentId, date),
 * delete later duplicate rows only. Does NOT touch sessions or unique students.
 *
 * node scripts/dedupeAttendanceByDate.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const dups = await prisma.$queryRaw`
    SELECT student_id AS "studentId", date::text AS d, COUNT(*)::int AS c
    FROM attendance
    GROUP BY student_id, date
    HAVING COUNT(*) > 1
  `;

  let deleted = 0;
  for (const row of dups) {
    const date = new Date(`${row.d}T00:00:00.000Z`);
    const records = await prisma.attendance.findMany({
      where: { studentId: row.studentId, date },
      orderBy: [{ markedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const keep = records[0]?.id;
    const remove = records.slice(1).map((r) => r.id);
    if (!remove.length) continue;
    const res = await prisma.attendance.deleteMany({ where: { id: { in: remove } } });
    deleted += res.count;
    console.log(`Kept ${keep}, removed ${remove.length} for student ${row.studentId} on ${row.d}`);
  }

  console.log(`Duplicate groups: ${dups.length}`);
  console.log(`Deleted duplicate rows: ${deleted}`);
  console.log('Earliest attendance per student/date preserved.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
