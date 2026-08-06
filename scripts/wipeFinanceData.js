/**
 * One-shot: wipe ALL finance transactional data so you can start fresh.
 * Keeps: students, coaches, auth, attendance, student monthlyFee/admissionFee/defaultDiscount.
 * Clears: fee months, fee payments, coach payments, finance sequences, advance balances.
 *
 * Usage: node scripts/wipeFinanceData.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Wiping finance data…');

  const payments = await prisma.studentFeePayment.deleteMany({});
  console.log(`  StudentFeePayment deleted: ${payments.count}`);

  const feeMonths = await prisma.studentFeeMonth.deleteMany({});
  console.log(`  StudentFeeMonth deleted: ${feeMonths.count}`);

  const coachPays = await prisma.coachPayment.deleteMany({});
  console.log(`  CoachPayment deleted: ${coachPays.count}`);

  const sequences = await prisma.financeSequence.deleteMany({});
  console.log(`  FinanceSequence deleted: ${sequences.count}`);

  const students = await prisma.student.updateMany({
    data: {
      advanceBalance: 0,
      paymentStatus: 'Pending',
    },
  });
  console.log(`  Students advanceBalance reset + paymentStatus=Pending: ${students.count}`);

  console.log('Done. Receipt numbers will restart from RCP-YYYY-000001 on next collect.');
}

main()
  .catch((err) => {
    console.error('Wipe failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
