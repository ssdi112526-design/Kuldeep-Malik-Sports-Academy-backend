/**
 * Central multi-method attendance marking.
 * Methods: QR | BIOMETRIC (MANUAL disabled)
 * Data plane source remains live|demo for existing filters/seeds.
 */
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import {
  attendanceStatusLabel,
  normalizeAttendanceStatus,
} from '../constants/attendanceStatus.js';
import { attendanceDateFromInstant, dateKey, parseDateOnly } from '../utils/attendanceDate.js';

export const ATTENDANCE_METHODS = ['QR', 'MANUAL', 'BIOMETRIC'];
export const ATTENDANCE_SESSION_SLOTS = ['morning', 'evening'];

export function normalizeSessionSlot(value, fallback = 'morning') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'evening' || raw === 'eve' || raw === 'pm') return 'evening';
  if (raw === 'morning' || raw === 'am') return 'morning';
  return fallback;
}

/** Split the academy day in IST: before 14:00 = morning, otherwise evening. */
export function inferAttendanceSessionSlot(markedAt = new Date()) {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    hour12: false,
  }).format(new Date(markedAt));
  const hour = Number(String(hourStr).replace(/[^\d]/g, '').slice(0, 2));
  return hour < 14 ? 'morning' : 'evening';
}

/** UI/export label — legacy `live` rows without method → QR */
export function displayAttendanceSource(row = {}) {
  const method = String(row.method || '').toUpperCase();
  if (ATTENDANCE_METHODS.includes(method)) return method;
  if (row.source === 'demo') return 'DEMO';
  return 'QR';
}

export function normalizeMethod(value, fallback = 'QR') {
  const m = String(value || fallback).toUpperCase();
  return ATTENDANCE_METHODS.includes(m) ? m : fallback;
}

function formatIstTime(d) {
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(d));
}

/**
 * Ensure biometricUserId is not used by another person (student or coach).
 */
export async function assertBiometricIdAvailable(biometricUserId, { excludeStudentId, excludeCoachId } = {}) {
  const id = String(biometricUserId || '').trim();
  if (!id) return null;

  const [studentHit, coachHit] = await Promise.all([
    prisma.student.findFirst({
      where: {
        biometricUserId: id,
        ...(excludeStudentId ? { id: { not: excludeStudentId } } : {}),
      },
      select: { id: true, fullName: true, registrationNumber: true },
    }),
    prisma.coach.findFirst({
      where: {
        biometricUserId: id,
        ...(excludeCoachId ? { id: { not: excludeCoachId } } : {}),
      },
      select: { id: true, fullName: true, coachCode: true },
    }),
  ]);

  if (studentHit || coachHit) {
    throw new ApiError(400, 'Biometric ID already assigned. Please choose another ID.');
  }
  return id;
}

export async function resolvePersonByBiometricUserId(biometricUserId) {
  const id = String(biometricUserId || '').trim();
  if (!id) return null;

  const student = await prisma.student.findFirst({
    where: { biometricUserId: id },
    select: {
      id: true,
      fullName: true,
      registrationNumber: true,
      status: true,
      biometricUserId: true,
    },
  });
  if (student) return { personType: 'student', person: student };

  const coach = await prisma.coach.findFirst({
    where: { biometricUserId: id },
    select: {
      id: true,
      fullName: true,
      coachCode: true,
      status: true,
      biometricUserId: true,
    },
  });
  if (coach) return { personType: 'coach', person: coach };

  return null;
}

/**
 * Mark student present for a calendar date (IST). Duplicate same-day → ApiError 409.
 */
export async function markStudentPresent({
  studentId,
  method = 'QR',
  markedAt = new Date(),
  attendanceSessionId = null,
  deviceId = null,
  biometricUserId = null,
  dataSource = 'live',
} = {}) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new ApiError(404, 'Student not found');
  if (student.status !== 'Active') {
    throw new ApiError(403, 'Student account is not active.');
  }

  const at = new Date(markedAt);
  const date = attendanceDateFromInstant(at);
  const sessionSlot = inferAttendanceSessionSlot(at);
  const methodNorm = normalizeMethod(method);
  if (methodNorm === 'MANUAL') {
    throw new ApiError(403, 'Manual attendance is disabled. Use QR scan or biometric.');
  }

  const already = await prisma.attendance.findFirst({
    where: { studentId: student.id, date, sessionSlot },
    select: { id: true, markedAt: true, method: true, source: true, sessionSlot: true },
  });
  if (already) {
    const err = new ApiError(
      409,
      `Attendance already marked for the ${sessionSlot} session today at ${formatIstTime(already.markedAt)} (${displayAttendanceSource(already)}).`,
      'ATTENDANCE_ALREADY_MARKED'
    );
    err.existing = already;
    throw err;
  }

  try {
    const record = await prisma.attendance.create({
      data: {
        studentId: student.id,
        attendanceSessionId: attendanceSessionId || null,
        registrationId: student.registrationNumber,
        date,
        markedAt: at,
        status: 'present',
        sessionSlot,
        source: dataSource === 'demo' ? 'demo' : 'live',
        method: methodNorm,
        deviceId: deviceId || null,
        biometricUserId: biometricUserId || student.biometricUserId || null,
      },
    });
    return {
      record,
      person: {
        type: 'student',
        id: student.id,
        name: student.fullName,
        code: student.registrationNumber,
      },
      date: dateKey(date),
      time: formatIstTime(at),
      method: methodNorm,
      sourceLabel: methodNorm,
    };
  } catch (e) {
    if (e?.code === 'P2002') {
      throw new ApiError(409, 'Attendance already marked today.', 'ATTENDANCE_ALREADY_MARKED');
    }
    throw e;
  }
}

/**
 * Admin upsert of player attendance status for a calendar date (IST date-only).
 * Creates or updates the unique studentId+date row.
 */
export async function upsertStudentAttendanceStatus({
  studentId,
  date,
  status,
  sessionSlot: sessionSlotInput,
  markedAt = new Date(),
  method = 'MANUAL',
  dataSource = 'live',
} = {}) {
  const statusKey = normalizeAttendanceStatus(status);
  if (!statusKey) {
    throw new ApiError(
      400,
      'Invalid attendance status. Use Present, Absent, Leave, Medical Leave, or Competition Leave.'
    );
  }

  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new ApiError(404, 'Player not found');

  let day;
  try {
    day = typeof date === 'string' ? parseDateOnly(date) : attendanceDateFromInstant(date || markedAt);
  } catch {
    throw new ApiError(400, 'Invalid date. Use YYYY-MM-DD');
  }

  const at = new Date(markedAt);
  const methodNorm = normalizeMethod(method, 'MANUAL');
  const sessionSlot = normalizeSessionSlot(sessionSlotInput, inferAttendanceSessionSlot(at));

  const record = await prisma.attendance.upsert({
    where: {
      studentId_date_sessionSlot: { studentId: student.id, date: day, sessionSlot },
    },
    create: {
      studentId: student.id,
      registrationId: student.registrationNumber,
      date: day,
      markedAt: at,
      status: statusKey,
      sessionSlot,
      source: dataSource === 'demo' ? 'demo' : 'live',
      method: methodNorm,
    },
    update: {
      status: statusKey,
      markedAt: at,
      method: methodNorm,
      source: dataSource === 'demo' ? 'demo' : 'live',
    },
  });

  return {
    record,
    date: dateKey(day),
    status: statusKey,
    statusLabel: attendanceStatusLabel(statusKey),
    person: {
      type: 'student',
      id: student.id,
      name: student.fullName,
      code: student.registrationNumber,
    },
  };
}

export async function markCoachPresentRecord({
  coachId,
  method = 'QR',
  markedAt = new Date(),
  attendanceSessionId = null,
  deviceId = null,
  biometricUserId = null,
  dataSource = 'live',
} = {}) {
  const coach = await prisma.coach.findUnique({ where: { id: coachId } });
  if (!coach) throw new ApiError(404, 'Coach not found');
  if (coach.status !== 'Active') {
    throw new ApiError(403, 'Coach account is not active.');
  }

  const at = new Date(markedAt);
  const date = attendanceDateFromInstant(at);
  const methodNorm = normalizeMethod(method);
  if (methodNorm === 'MANUAL') {
    throw new ApiError(403, 'Manual attendance is disabled. Use QR scan or biometric.');
  }

  const already = await prisma.coachAttendance.findFirst({
    where: { coachId: coach.id, date },
    select: { id: true, markedAt: true, method: true, source: true },
  });
  if (already) {
    const err = new ApiError(
      409,
      `Attendance already marked today at ${formatIstTime(already.markedAt)} (${displayAttendanceSource(already)}).`,
      'ATTENDANCE_ALREADY_MARKED'
    );
    err.existing = already;
    throw err;
  }

  try {
    const record = await prisma.coachAttendance.create({
      data: {
        coachId: coach.id,
        attendanceSessionId: attendanceSessionId || null,
        coachCode: coach.coachCode,
        date,
        markedAt: at,
        status: 'present',
        source: dataSource === 'demo' ? 'demo' : 'live',
        method: methodNorm,
        deviceId: deviceId || null,
        biometricUserId: biometricUserId || coach.biometricUserId || null,
      },
    });
    return {
      record,
      person: {
        type: 'coach',
        id: coach.id,
        name: coach.fullName,
        code: coach.coachCode,
      },
      date: dateKey(date),
      time: formatIstTime(at),
      method: methodNorm,
      sourceLabel: methodNorm,
    };
  } catch (e) {
    if (e?.code === 'P2002') {
      throw new ApiError(409, 'Attendance already marked today.', 'ATTENDANCE_ALREADY_MARKED');
    }
    throw e;
  }
}
