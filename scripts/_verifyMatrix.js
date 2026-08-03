import { buildAttendanceMatrix } from '../src/services/attendanceCalc.js';
import prisma from '../src/config/db.js';

const m = await buildAttendanceMatrix({ period: 'select', year: 2026, month: 7 });
const present = m.rows.filter((r) => r.status === 'Present').length;
const absent = m.rows.filter((r) => r.status === 'Absent').length;
const sample = m.rows.slice(0, 3);
console.log(
  JSON.stringify(
    {
      totalRows: m.rows.length,
      present,
      absent,
      students: m.summary.totalStudents,
      trainingDays: m.summary.trainingDays,
      sample,
    },
    null,
    2
  )
);
await prisma.$disconnect();
