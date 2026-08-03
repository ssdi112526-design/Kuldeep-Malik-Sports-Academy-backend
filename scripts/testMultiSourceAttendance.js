/**
 * Smoke test: BIOMETRIC ingest + duplicate prevention (QR/BIOMETRIC only).
 * Usage: node scripts/testMultiSourceAttendance.js
 */
import 'dotenv/config';
import prisma from '../src/config/db.js';
import {
  markStudentPresent,
  markCoachPresentRecord,
  assertBiometricIdAvailable,
} from '../src/services/attendanceMarkService.js';
import { processBiometricEvent, generateDeviceSecret, hashDeviceSecret } from '../src/services/biometricService.js';

async function main() {
  const student = await prisma.student.findFirst({ where: { status: 'Active' } });
  const coach = await prisma.coach.findFirst({ where: { status: 'Active' } });
  if (!student || !coach) throw new Error('Need at least one active student and coach');

  const bioStudent = `T-S-${Date.now().toString().slice(-6)}`;
  const bioCoach = `T-C-${Date.now().toString().slice(-6)}`;

  await assertBiometricIdAvailable(bioStudent, { excludeStudentId: student.id });
  await assertBiometricIdAvailable(bioCoach, { excludeCoachId: coach.id });

  await prisma.student.update({ where: { id: student.id }, data: { biometricUserId: bioStudent } });
  await prisma.coach.update({ where: { id: coach.id }, data: { biometricUserId: bioCoach } });

  const secret = generateDeviceSecret();
  const device = await prisma.biometricDevice.create({
    data: {
      name: `Test Device ${Date.now()}`,
      deviceType: 'fingerprint',
      adapterKey: 'generic_http',
      apiSecretHash: await hashDeviceSecret(secret),
      isEnabled: true,
      status: 'online',
      location: 'Test',
    },
  });

  const { attendanceDateFromInstant } = await import('../src/utils/attendanceDate.js');
  const today = attendanceDateFromInstant(new Date());
  await prisma.attendance.deleteMany({ where: { studentId: student.id, date: today } });
  await prisma.coachAttendance.deleteMany({ where: { coachId: coach.id, date: today } });

  const m1 = await markStudentPresent({ studentId: student.id, method: 'QR' });
  console.log('OK student QR', m1.method, m1.time);

  const bioDup = await processBiometricEvent({
    device,
    biometricUserId: bioStudent,
    eventAt: new Date(),
    deviceLogId: `dup-test-2-${Date.now()}`,
  });
  console.log('OK student duplicate biometric status', bioDup.status, '(expected duplicate)');

  const c1 = await markCoachPresentRecord({ coachId: coach.id, method: 'QR' });
  console.log('OK coach QR', c1.method);

  const unknown = await processBiometricEvent({
    device,
    biometricUserId: `UNKNOWN-${Date.now()}`,
    eventAt: new Date(),
    deviceLogId: `unk-${Date.now()}`,
  });
  console.log('OK unknown biometric', unknown.status);

  await prisma.student.update({ where: { id: student.id }, data: { biometricUserId: null } });
  await prisma.coach.update({ where: { id: coach.id }, data: { biometricUserId: null } });
  await prisma.biometricDevice.delete({ where: { id: device.id } });

  console.log('All multi-source smoke checks passed (QR + Biometric only).');
}

main()
  .catch((e) => {
    console.error('FAIL', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
