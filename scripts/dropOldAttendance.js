import prisma from '../src/config/db.js';

async function main() {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS attendance_audits CASCADE');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS attendance CASCADE');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS attendance_sessions CASCADE');
  await prisma.$executeRawUnsafe('DROP TYPE IF EXISTS "AttendanceStatus" CASCADE');
  await prisma.$executeRawUnsafe('DROP TYPE IF EXISTS "AttendanceSessionStatus" CASCADE');
  console.log('Attendance artifacts cleared');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
