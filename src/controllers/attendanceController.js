import crypto from 'crypto';
import QRCode from 'qrcode';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withId, withIds } from '../utils/serialize.js';
import { writeAuditLog } from '../utils/rbac.js';
import { toXlsxBuffer, toAttendanceReportXlsx } from '../utils/exportUtils.js';
import {
  attendanceDateFromInstant,
  dateKey,
  parseDateOnly,
} from '../utils/attendanceDate.js';
import {
  calculateAttendanceSummary,
  calculateStudentAttendance,
  calculateTodayStats,
  refreshStudentAttendanceCounters,
  resolvePeriodFilter,
  buildAttendanceMatrix,
  paginateRows,
  getDailyRoster,
  getStudentAttendanceHistory,
} from '../services/attendanceCalc.js';
import { assertQrGeofence } from '../services/geofenceService.js';
import { encodeAttendanceQrContent } from '../utils/attendanceQrUrl.js';

/** One-time QR lifetime in seconds (default 60). */
const QR_TTL_SECONDS = Math.min(
  3600,
  Math.max(15, Number(process.env.ATTENDANCE_QR_TTL_SECONDS || 60))
);

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function safeResolvePeriod(input = {}) {
  try {
    return resolvePeriodFilter(input);
  } catch (err) {
    throw new ApiError(err.statusCode || 400, err.message || 'Invalid period filter');
  }
}

function buildAttendanceWhere(input = {}) {
  const period = safeResolvePeriod(input);
  const where = {};
  if (period.from || period.to) {
    where.date = {};
    if (period.from) where.date.gte = period.from;
    if (period.to) where.date.lte = period.to;
  }
  const search = String(input.search || input.student || '').trim();
  if (search) {
    where.OR = [
      { registrationId: { contains: search, mode: 'insensitive' } },
      { student: { fullName: { contains: search, mode: 'insensitive' } } },
      { student: { fatherName: { contains: search, mode: 'insensitive' } } },
      { student: { registrationNumber: { contains: search, mode: 'insensitive' } } },
      { studentId: search },
    ];
  }
  if (input.registrationId) {
    where.registrationId = { contains: String(input.registrationId).trim(), mode: 'insensitive' };
  }
  if (input.status === 'present') where.status = 'present';
  return { where, period };
}

function exportFilenameStamp(period) {
  if (period.period === 'all') return 'All-Time';
  if (period.year && period.month) {
    const label = new Date(Date.UTC(period.year, period.month - 1, 1)).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return label.replace(' ', '-');
  }
  const from = period.from instanceof Date ? period.from : period.from ? parseDateOnly(period.from) : null;
  const to = period.to instanceof Date ? period.to : period.to ? parseDateOnly(period.to) : null;
  if (from && to) {
    const fromKey = dateKey(from);
    const toKey = dateKey(to);
    if (fromKey.slice(0, 7) === toKey.slice(0, 7) && fromKey.endsWith('-01')) {
      const last = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
      if (toKey === dateKey(last)) {
        const label = from.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return label.replace(' ', '-');
      }
    }
    return `${fromKey}_to_${toKey}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function makeRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function expireStaleSessions(tx = prisma) {
  const now = new Date();
  await tx.attendanceSession.updateMany({
    where: { status: 'ACTIVE', expiresAt: { lt: now } },
    data: { status: 'EXPIRED', closedAt: now, displayToken: null },
  });
}

async function nextSessionCode(tx = prisma) {
  const day = new Date();
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  const prefix = `ATT-${y}${m}${d}-`;
  const last = await tx.attendanceSession.findFirst({
    where: { sessionCode: { startsWith: prefix } },
    orderBy: { sessionCode: 'desc' },
    select: { sessionCode: true },
  });
  let n = 1;
  if (last?.sessionCode) {
    const part = last.sessionCode.slice(prefix.length);
    const parsed = Number.parseInt(part, 10);
    if (Number.isFinite(parsed)) n = parsed + 1;
  }
  return `${prefix}${String(n).padStart(3, '0')}`;
}

function publicSession(session, { qrPayload, qrDataUrl } = {}) {
  if (!session) return null;
  return {
    id: session.id,
    _id: session.id,
    sessionCode: session.sessionCode,
    status: session.status,
    expiresAt: session.expiresAt,
    usedAt: session.usedAt || null,
    usedByStudentId: session.usedByStudentId || null,
    closedAt: session.closedAt,
    createdAt: session.createdAt,
    ttlSeconds: QR_TTL_SECONDS,
    createdBy: session.createdBy
      ? { id: session.createdBy.id, name: session.createdBy.name }
      : null,
    qrPayload: qrPayload || null,
    qrDataUrl: qrDataUrl || null,
  };
}

async function buildQrAssets(session, rawToken) {
  const payload = {
    type: 'akhada_attendance',
    sessionId: session.id,
    sessionCode: session.sessionCode,
    token: rawToken,
    expiresAt: session.expiresAt.toISOString(),
  };
  // Encode as website URL so phone camera opens the site (not raw JSON).
  const qrContent = encodeAttendanceQrContent(payload);
  const qrDataUrl = await QRCode.toDataURL(qrContent, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 512,
  });
  return { qrPayload: payload, qrDataUrl, qrUrl: qrContent };
}

async function createActiveSession(tx, { createdById, ttlSeconds = QR_TTL_SECONDS }) {
  const rawToken = makeRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const sessionCode = await nextSessionCode(tx);
  const session = await tx.attendanceSession.create({
    data: {
      sessionCode,
      tokenHash,
      displayToken: rawToken,
      status: 'ACTIVE',
      source: 'live',
      expiresAt,
      createdById: createdById || null,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  return { session, rawToken };
}

/**
 * If desk is open (latest QR was USED/EXPIRED, not CLOSED) and nothing is ACTIVE,
 * mint a replacement QR so admin display keeps rotating.
 */
async function ensureActiveSessionForDesk(createdById) {
  await expireStaleSessions();
  const active = await prisma.attendanceSession.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (active) return active;

  const latest = await prisma.attendanceSession.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });
  if (!latest || latest.status === 'CLOSED') return null;

  const { session } = await prisma.$transaction(async (tx) => {
    await expireStaleSessions(tx);
    const stillActive = await tx.attendanceSession.findFirst({ where: { status: 'ACTIVE' } });
    if (stillActive) {
      return {
        session: await tx.attendanceSession.findFirst({
          where: { id: stillActive.id },
          include: { createdBy: { select: { id: true, name: true } } },
        }),
      };
    }
    const latestInside = await tx.attendanceSession.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    if (!latestInside || latestInside.status === 'CLOSED') return { session: null };
    return createActiveSession(tx, { createdById });
  });
  return session;
}

/** Admin: create new QR session (closes previous ACTIVE) */
export const generateAttendanceQr = asyncHandler(async (req, res) => {
  const ttlSeconds = Math.min(
    3600,
    Math.max(15, Number(req.body.ttlSeconds) || QR_TTL_SECONDS)
  );

  const { session, rawToken } = await prisma.$transaction(
    async (tx) => {
      await expireStaleSessions(tx);
      await tx.attendanceSession.updateMany({
        where: { status: 'ACTIVE' },
        data: { status: 'CLOSED', closedAt: new Date(), displayToken: null },
      });
      return createActiveSession(tx, { createdById: req.user.id, ttlSeconds });
    },
    { maxWait: 10000, timeout: 20000 }
  );

  const assets = await buildQrAssets(session, rawToken);

  await writeAuditLog({
    userId: req.user.id,
    action: 'attendance_qr_generate',
    entity: 'attendance_session',
    entityId: session.id,
    details: { sessionCode: session.sessionCode, ttlSeconds },
    req,
  });

  res.status(201).json({
    success: true,
    message: 'Attendance QR generated',
    data: { session: publicSession(session, assets) },
  });
});

export const getActiveAttendanceQr = asyncHandler(async (req, res) => {
  let session = await ensureActiveSessionForDesk(req.user?.id);
  if (!session) {
    return res.json({ success: true, data: { session: null, ttlSeconds: QR_TTL_SECONDS } });
  }
  // Heal ACTIVE sessions that lost displayToken (QR image would otherwise be blank).
  if (!session.displayToken) {
    const rawToken = makeRawToken();
    session = await prisma.attendanceSession.update({
      where: { id: session.id },
      data: { displayToken: rawToken, tokenHash: hashToken(rawToken) },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }
  const assets = await buildQrAssets(session, session.displayToken);
  res.json({
    success: true,
    data: { session: publicSession(session, assets), ttlSeconds: QR_TTL_SECONDS },
  });
});

export const closeAttendanceQr = asyncHandler(async (req, res) => {
  await expireStaleSessions();
  const id = req.params.id || req.body.sessionId;
  const where = id ? { id, status: 'ACTIVE' } : { status: 'ACTIVE' };
  const session = await prisma.attendanceSession.findFirst({ where });
  if (!session) throw new ApiError(404, 'No active attendance QR is available.');

  const updated = await prisma.attendanceSession.update({
    where: { id: session.id },
    data: { status: 'CLOSED', closedAt: new Date(), displayToken: null },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  await writeAuditLog({
    userId: req.user.id,
    action: 'attendance_qr_close',
    entity: 'attendance_session',
    entityId: updated.id,
    details: { sessionCode: updated.sessionCode },
    req,
  });

  res.json({
    success: true,
    message: 'Attendance QR closed',
    data: { session: publicSession(updated) },
  });
});

export const listAttendanceSessions = asyncHandler(async (req, res) => {
  await expireStaleSessions();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const [total, rows] = await Promise.all([
    prisma.attendanceSession.count(),
    prisma.attendanceSession.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        createdBy: { select: { id: true, name: true } },
        usedByStudent: { select: { id: true, fullName: true, registrationNumber: true } },
        _count: { select: { records: true } },
      },
    }),
  ]);
  res.json({
    success: true,
    data: {
      sessions: rows.map((s) => ({
        ...publicSession(s),
        presentCount: s._count.records,
        usedBy: s.usedByStudent
          ? {
              id: s.usedByStudent.id,
              fullName: s.usedByStudent.fullName,
              registrationNumber: s.usedByStudent.registrationNumber,
            }
          : null,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

export const getAttendanceStats = asyncHandler(async (req, res) => {
  let date;
  if (req.query.date) {
    try {
      date = parseDateOnly(req.query.date);
    } catch {
      throw new ApiError(400, 'Invalid date. Use YYYY-MM-DD');
    }
  }
  const data = await calculateTodayStats({ date });
  res.json({ success: true, data });
});

export const listAvailableAttendanceMonths = asyncHandler(async (_req, res) => {
  const rows = await prisma.attendance.findMany({
    select: { date: true },
    distinct: ['date'],
    orderBy: { date: 'desc' },
  });
  const map = new Map();
  for (const r of rows) {
    const d = new Date(r.date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (!map.has(key)) {
      map.set(key, {
        year: y,
        month: m,
        label: new Intl.DateTimeFormat('en-IN', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(d),
      });
    }
  }
  res.json({ success: true, data: { months: [...map.values()] } });
});

export const listAttendanceRecords = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const view = String(req.query.view || 'matrix').toLowerCase();

  // Full Present+Absent matrix (default) — includes students with no DB row as Absent
  if (view !== 'scans') {
    const matrix = await buildAttendanceMatrix(req.query);
    const paged = paginateRows(matrix.rows, page, limit);
    return res.json({
      success: true,
      data: {
        view: 'matrix',
        period: matrix.period,
        summary: matrix.summary,
        records: paged.rows.map((r) => ({
          id: `${r.studentId}_${r.date}`,
          date: r.date,
          markedAt: r.markedAt,
          status: r.status.toLowerCase() === 'present' ? 'present' : 'absent',
          statusLabel: r.status,
          registrationId: r.registrationId,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          sessionCode: r.sessionCode || null,
          method: r.method || null,
          source: r.source || null,
          sourceLabel: r.sourceLabel || '—',
          distanceFromAkhada: r.distanceFromAkhada ?? null,
          locationVerified: r.locationVerified ?? null,
          distanceLabel: r.distanceLabel || '—',
          locationLabel: r.locationLabel || '—',
          student: {
            id: r.studentId,
            fullName: r.studentName,
            fatherName: r.fatherName,
            batch: r.batch,
            membershipType: r.membershipType,
            registrationNumber: r.registrationId,
          },
        })),
        pagination: paged.pagination,
      },
    });
  }

  const { where, period } = buildAttendanceWhere(req.query);
  const [total, rows, calc] = await Promise.all([
    prisma.attendance.count({ where }),
    prisma.attendance.findMany({
      where,
      orderBy: [{ markedAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            registrationNumber: true,
            fatherName: true,
            mobileNumber: true,
            photo: true,
            batch: true,
            membershipType: true,
          },
        },
        session: { select: { id: true, sessionCode: true, status: true, source: true } },
      },
    }),
    calculateAttendanceSummary(req.query),
  ]);

  res.json({
    success: true,
    data: {
      view: 'scans',
      period: calc.period,
      summary: calc.summary,
      records: withIds(
        rows.map((r) => ({
          id: r.id,
          date: dateKey(r.date),
          markedAt: r.markedAt,
          status: r.status,
          statusLabel: 'Present',
          registrationId: r.registrationId,
          sessionCode: r.session?.sessionCode,
          attendanceSessionId: r.attendanceSessionId,
          source: r.source || r.session?.source || 'live',
          method: r.method || 'QR',
          sourceLabel:
            String(r.method || 'QR').toUpperCase() === 'BIOMETRIC'
              ? 'Biometric'
              : String(r.method || 'QR').toUpperCase() === 'MANUAL'
                ? 'Manual'
                : 'QR',
          student: r.student ? withId(r.student) : null,
        }))
      ),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

export const listDailyRoster = asyncHandler(async (req, res) => {
  if (!req.query.date) throw new ApiError(400, 'date is required (YYYY-MM-DD)');
  try {
    parseDateOnly(req.query.date);
  } catch {
    throw new ApiError(400, 'Invalid date. Use YYYY-MM-DD');
  }
  const data = await getDailyRoster(req.query);
  res.json({ success: true, data });
});

export const getStudentHistory = asyncHandler(async (req, res) => {
  const data = await getStudentAttendanceHistory(req.params.studentId, req.query);
  if (!data) throw new ApiError(404, 'Student not found');
  res.json({ success: true, data });
});

export const getStudentAttendanceSummary = asyncHandler(async (req, res) => {
  const calc = await calculateAttendanceSummary(req.query);
  let rows = calc.students.map((s) => ({
    studentId: s.studentId,
    registrationId: s.registrationId,
    fullName: s.fullName,
    fatherName: s.fatherName,
    batch: s.batch,
    membershipType: s.membershipType,
    trainingDays: s.trainingDays,
    present: s.presentDays,
    presentDays: s.presentDays,
    absent: s.absentDays,
    absentDays: s.absentDays,
    attendanceRate: s.attendancePercentage,
    attendancePercentage: s.attendancePercentage,
  }));

  const sort = String(req.query.sort || 'name').toLowerCase();
  if (sort === 'highest') rows.sort((a, b) => b.attendanceRate - a.attendanceRate);
  else if (sort === 'lowest') rows.sort((a, b) => a.attendanceRate - b.attendanceRate);
  else if (sort === 'reg') rows.sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  else rows.sort((a, b) => a.fullName.localeCompare(b.fullName));

  res.json({
    success: true,
    data: {
      period: calc.period,
      trainingDays: calc.summary.trainingDays,
      summary: calc.summary,
      students: rows,
    },
  });
});

export const getAttendanceRecord = asyncHandler(async (req, res) => {
  const row = await prisma.attendance.findUnique({
    where: { id: req.params.id },
    include: {
      student: true,
      session: { select: { id: true, sessionCode: true, status: true, createdAt: true, source: true } },
    },
  });
  if (!row) throw new ApiError(404, 'Attendance record not found');
  res.json({ success: true, data: { record: withId(row) } });
});

export const exportAttendanceExcel = asyncHandler(async (req, res) => {
  const input = { ...req.query, ...req.body };
  const reportType = String(input.reportType || 'matrix').toLowerCase();
  const { where, period } = buildAttendanceWhere(input);

  if (reportType === 'summary') {
    const calc = await calculateAttendanceSummary(input);
    const rows = calc.students
      .map((r, i) => ({
        serial: i + 1,
        registrationId: r.registrationId,
        studentName: r.fullName,
        fatherName: r.fatherName || 0,
        trainingDays: r.trainingDays,
        present: r.presentDays,
        absent: r.absentDays,
        attendanceRate: `${r.attendancePercentage}%`,
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName))
      .map((r, i) => ({ ...r, serial: i + 1 }));

    const columns = [
      { key: 'serial', label: 'S.No', width: 8 },
      { key: 'registrationId', label: 'Registration ID', width: 16 },
      { key: 'studentName', label: 'Student Name', width: 22 },
      { key: 'fatherName', label: 'Father Name', width: 20 },
      { key: 'trainingDays', label: 'Total Training Days', width: 14 },
      { key: 'present', label: 'Present', width: 10 },
      { key: 'absent', label: 'Absent', width: 10 },
      { key: 'attendanceRate', label: 'Attendance %', width: 14 },
    ];
    const buffer = await toXlsxBuffer(rows, columns, { sheetName: 'Student Summary', colorStatus: false });
    const stamp = exportFilenameStamp({ ...period, ...calc.period });
    const filename = `raghunandan_akhada_attendance_${stamp.toLowerCase().replace(/\s+/g, '_')}_summary.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  }

  // Default / matrix / records: full Present+Absent report
  if (reportType === 'matrix' || reportType === 'records' || reportType === 'full') {
    const matrix = await buildAttendanceMatrix(input);
    const dailySorted = [...matrix.rows].sort((a, b) => {
      if (a.date === b.date) return a.studentName.localeCompare(b.studentName);
      return a.date < b.date ? -1 : 1;
    });
    const dailyRows = dailySorted.map((r, i) => ({
      serial: i + 1,
      registrationId: r.registrationId,
      studentName: r.studentName,
      fatherName: r.fatherName,
      batch: r.batch,
      membershipType: r.membershipType,
      dateDisplay: r.dateDisplay,
      status: r.status,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      sourceLabel: r.sourceLabel || (r.status === 'Present' ? 'QR' : '—'),
      distanceLabel: r.distanceLabel || '—',
      locationLabel: r.locationLabel || '—',
    }));
    const summaryRows = matrix.students
      .map((r) => ({
        registrationId: r.registrationId,
        studentName: r.fullName,
        fatherName: r.fatherName || 0,
        trainingDays: r.trainingDays,
        present: r.presentDays,
        absent: r.absentDays,
        attendanceRate: `${r.attendancePercentage}%`,
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName))
      .map((r, i) => ({ ...r, serial: i + 1 }));

    const stamp = exportFilenameStamp({ ...period, ...matrix.period });
    const buffer = await toAttendanceReportXlsx({
      dailyRows,
      summaryRows,
      title: `Kuldeep Malik Sports Academy Attendance — ${stamp}`,
    });
    const filename = `raghunandan_akhada_attendance_${stamp.toLowerCase().replace(/\s+/g, '_')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  }

  // Legacy raw scan export
  const records = await prisma.attendance.findMany({
    where,
    orderBy: [{ markedAt: 'desc' }],
    take: 20000,
    include: {
      student: { select: { fullName: true, fatherName: true, mobileNumber: true, batch: true } },
      session: { select: { sessionCode: true } },
    },
  });

  const columns = [
    { key: 'serial', label: 'S.No' },
    { key: 'date', label: 'Date' },
    { key: 'time', label: 'Time' },
    { key: 'registrationId', label: 'Registration ID' },
    { key: 'studentName', label: 'Student Name' },
    { key: 'fatherName', label: 'Father Name' },
    { key: 'mobileNumber', label: 'Mobile Number' },
    { key: 'status', label: 'Status' },
    { key: 'sessionCode', label: 'Attendance Session ID' },
  ];

  const rows = records.map((r, i) => ({
    serial: i + 1,
    date: dateKey(r.date),
    time: new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }).format(new Date(r.markedAt)),
    registrationId: r.registrationId,
    studentName: r.student?.fullName || 0,
    fatherName: r.student?.fatherName || 0,
    mobileNumber: r.student?.mobileNumber || '',
    status: 'Present',
    sessionCode: r.session?.sessionCode || '',
  }));

  const buffer = await toXlsxBuffer(rows, columns, { sheetName: 'Scan Records', colorStatus: true });
  const stamp = exportFilenameStamp(period);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="raghunandan_akhada_scans_${stamp.toLowerCase()}.xlsx"`);
  return res.send(buffer);
});

/**
 * Student scan — STRICT one-time QR.
 * Atomic claim ACTIVE → USED, then create attendance + next ACTIVE QR in one transaction.
 */
export const scanAttendance = asyncHandler(async (req, res) => {
  const studentId = req.user.studentId;
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new ApiError(404, 'Student not found');
  if (student.status !== 'Active') {
    throw new ApiError(403, 'Your student account is not active. Please contact the Academy administrator.');
  }

  let payload = req.body?.payload ?? req.body?.qrData ?? req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new ApiError(
        400,
        'Invalid Attendance QR.\nPlease scan the current QR displayed by the admin.',
        'QR_INVALID'
      );
    }
  }

  const sessionId = payload?.sessionId;
  const token = payload?.token;
  if (payload?.type === 'akhada_coach_attendance') {
    throw new ApiError(
      400,
      'Coach QR cannot be used for student attendance.\nPlease scan the student attendance QR.',
      'WRONG_ATTENDANCE_TYPE'
    );
  }
  if (!sessionId || !token || payload?.type !== 'akhada_attendance') {
    throw new ApiError(
      400,
      'Invalid Attendance QR.\nPlease scan the current QR displayed by the admin.',
      'QR_INVALID'
    );
  }

  // GPS geofence — before consuming QR
  const geo = await assertQrGeofence({
    latitude: req.body?.latitude ?? payload?.latitude,
    longitude: req.body?.longitude ?? payload?.longitude,
    accuracy: req.body?.accuracy ?? req.body?.gpsAccuracy ?? payload?.accuracy,
    timestamp: req.body?.timestamp ?? payload?.timestamp,
  });

  const tokenHash = hashToken(token);
  const markedAt = new Date();
  const date = attendanceDateFromInstant(markedAt);

  // Reject duplicate daily attendance BEFORE consuming the QR
  const alreadyToday = await prisma.attendance.findFirst({
    where: { studentId: student.id, date },
    select: { id: true },
  });
  if (alreadyToday) {
    throw new ApiError(409, 'Your attendance for today has already been marked.', 'ATTENDANCE_ALREADY_MARKED');
  }

  const existingSession = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
  if (!existingSession) {
    throw new ApiError(
      400,
      'Invalid Attendance QR.\nPlease scan the current QR displayed by the admin.',
      'QR_INVALID'
    );
  }
  if (existingSession.tokenHash !== tokenHash) {
    throw new ApiError(
      400,
      'Invalid Attendance QR.\nPlease scan the current QR displayed by the admin.',
      'QR_INVALID'
    );
  }
  if (existingSession.status === 'USED') {
    throw new ApiError(
      409,
      'This QR code has already been used. Please scan the new QR code.',
      'QR_ALREADY_USED'
    );
  }
  if (existingSession.status === 'CLOSED') {
    throw new ApiError(
      400,
      'No active attendance QR is available.\nPlease contact the Academy administrator.',
      'QR_CLOSED'
    );
  }
  if (existingSession.status === 'EXPIRED' || existingSession.expiresAt < new Date()) {
    if (existingSession.status === 'ACTIVE') {
      await prisma.attendanceSession.updateMany({
        where: { id: existingSession.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED', closedAt: new Date(), displayToken: null },
      });
    }
    throw new ApiError(400, 'This attendance QR has expired.\nPlease scan the new QR.', 'QR_EXPIRED');
  }

  // Short atomic core only: claim QR + create attendance (remote DB needs higher timeout)
  let record;
  let usedSessionCode = existingSession.sessionCode;
  const createdById = existingSession.createdById || null;

  try {
    const core = await prisma.$transaction(
      async (tx) => {
        const alreadyInTx = await tx.attendance.findFirst({
          where: { studentId: student.id, date },
          select: { id: true },
        });
        if (alreadyInTx) {
          throw new ApiError(
            409,
            'Your attendance for today has already been marked.',
            'ATTENDANCE_ALREADY_MARKED'
          );
        }

        const claimed = await tx.attendanceSession.updateMany({
          where: {
            id: sessionId,
            status: 'ACTIVE',
            tokenHash,
            expiresAt: { gt: new Date() },
          },
          data: {
            status: 'USED',
            usedAt: markedAt,
            usedByStudentId: student.id,
            displayToken: null,
          },
        });

        if (claimed.count !== 1) {
          const fresh = await tx.attendanceSession.findUnique({ where: { id: sessionId } });
          if (fresh?.status === 'USED') {
            throw new ApiError(
              409,
              'This QR code has already been used. Please scan the new QR code.',
              'QR_ALREADY_USED'
            );
          }
          if (fresh?.status === 'EXPIRED') {
            throw new ApiError(400, 'This attendance QR has expired.\nPlease scan the new QR.', 'QR_EXPIRED');
          }
          throw new ApiError(400, 'Please scan the new QR displayed by the admin.', 'QR_REPLACED');
        }

        try {
          const created = await tx.attendance.create({
            data: {
              studentId: student.id,
              attendanceSessionId: sessionId,
              registrationId: student.registrationNumber,
              date,
              markedAt,
              status: 'present',
              source: 'live',
              method: 'QR',
              latitude: geo.latitude,
              longitude: geo.longitude,
              gpsAccuracy: geo.gpsAccuracy,
              distanceFromAkhada: geo.distanceFromAkhada,
              locationVerified: geo.locationVerified,
            },
          });
          return { record: created };
        } catch (err) {
          if (err?.code === 'P2002') {
            throw new ApiError(
              409,
              'Your attendance for today has already been marked.',
              'ATTENDANCE_ALREADY_MARKED'
            );
          }
          throw err;
        }
      },
      { maxWait: 10000, timeout: 20000 }
    );
    record = core.record;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw err;
  }

  // Non-critical follow-up work (outside the hot transaction)
  try {
    await refreshStudentAttendanceCounters(student.id);
  } catch {
    /* counters can refresh later */
  }

  let nextSession = null;
  let nextToken = null;
  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const active = await tx.attendanceSession.findFirst({ where: { status: 'ACTIVE' } });
        if (active) {
          return {
            session: await tx.attendanceSession.findFirst({
              where: { id: active.id },
              include: { createdBy: { select: { id: true, name: true } } },
            }),
            rawToken: active.displayToken,
          };
        }
        return createActiveSession(tx, { createdById });
      },
      { maxWait: 10000, timeout: 20000 }
    );
    nextSession = created.session;
    nextToken = created.rawToken;
  } catch {
    /* Admin polling / ensureActiveSessionForDesk will mint the next QR */
  }

  const nextAssets =
    nextSession && nextToken ? await buildQrAssets(nextSession, nextToken) : { qrPayload: null, qrDataUrl: null };

  await writeAuditLog({
    userId: req.user.id,
    action: 'attendance_scan',
    entity: 'attendance',
    entityId: record.id,
    details: {
      usedSessionCode,
      nextSessionCode: nextSession?.sessionCode,
      registrationId: student.registrationNumber,
    },
    req,
  });

  res.status(201).json({
    success: true,
    message: 'Attendance Marked Successfully',
    data: {
      attendance: {
        id: record.id,
        studentName: student.fullName,
        name: student.fullName,
        type: 'Student',
        registrationId: student.registrationNumber,
        date: dateKey(date),
        time: new Intl.DateTimeFormat('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        }).format(markedAt),
        status: 'Present',
        method: 'QR',
        source: 'QR',
        sourceLabel: 'QR',
        sessionCode: usedSessionCode,
        distanceFromAkhada: geo.distanceFromAkhada,
        distanceMeters: geo.distanceFromAkhada,
        gpsAccuracy: geo.gpsAccuracy,
        locationVerified: geo.locationVerified === true,
        allowedRadiusMeters: geo.settings?.allowedRadiusMeters ?? null,
      },
      nextSession: nextSession ? publicSession(nextSession, nextAssets) : null,
    },
  });
});

export const getMyAttendance = asyncHandler(async (req, res) => {
  const studentId = req.user.studentId;
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new ApiError(404, 'Student not found');

  const [calc, records] = await Promise.all([
    calculateStudentAttendance(studentId, { period: 'all' }),
    prisma.attendance.findMany({
      where: { studentId },
      orderBy: [{ date: 'desc' }, { markedAt: 'desc' }],
      take: 200,
      include: { session: { select: { sessionCode: true } } },
    }),
  ]);

  // Deduplicate display rows by date (keep earliest scan of the day for display consistency)
  const seenDates = new Set();
  const uniqueRecords = [];
  for (const r of records) {
    const key = dateKey(r.date);
    if (seenDates.has(key)) continue;
    seenDates.add(key);
    uniqueRecords.push(r);
  }

  res.json({
    success: true,
    data: {
      summary: {
        present: calc?.presentDays || 0,
        absent: calc?.absentDays || 0,
        totalDays: calc?.trainingDays || 0,
        trainingDays: calc?.trainingDays || 0,
        presentDays: calc?.presentDays || 0,
        absentDays: calc?.absentDays || 0,
        attendanceRate: calc?.attendancePercentage || 0,
        attendancePercentage: calc?.attendancePercentage || 0,
      },
      records: uniqueRecords.map((r) => ({
        id: r.id,
        date: dateKey(r.date),
        time: new Intl.DateTimeFormat('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        }).format(new Date(r.markedAt)),
        status: 'Present',
        sessionCode: r.session?.sessionCode,
      })),
    },
  });
});

export const getMyStudentProfile = asyncHandler(async (req, res) => {
  const student = await prisma.student.findUnique({
    where: { id: req.user.studentId },
    include: {
      coach: { select: { id: true, fullName: true } },
    },
  });
  if (!student) throw new ApiError(404, 'Student not found');
  res.json({ success: true, data: { student: withId(student) } });
});
