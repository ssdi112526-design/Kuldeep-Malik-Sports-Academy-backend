import crypto from 'crypto';
import QRCode from 'qrcode';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { writeAuditLog } from '../utils/rbac.js';
import { toXlsxBuffer, toAttendanceReportXlsx } from '../utils/exportUtils.js';
import {
  attendanceDateFromInstant,
  dateKey,
  parseDateOnly,
} from '../utils/attendanceDate.js';
import {
  calculateCoachAttendanceSummary,
  calculateTodayCoachStats,
  buildCoachAttendanceMatrix,
  getCoachAttendanceHistory,
  paginateRows,
} from '../services/coachAttendanceCalc.js';
import { resolvePeriodFilter } from '../services/attendanceCalc.js';
import { assertQrGeofence } from '../services/geofenceService.js';
import { encodeAttendanceQrContent } from '../utils/attendanceQrUrl.js';

const QR_TTL_SECONDS = Math.min(
  3600,
  Math.max(15, Number(process.env.ATTENDANCE_QR_TTL_SECONDS || 60))
);

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function makeRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function safeResolvePeriod(input = {}) {
  try {
    return resolvePeriodFilter(input);
  } catch (err) {
    throw new ApiError(err.statusCode || 400, err.message || 'Invalid period filter');
  }
}

function exportFilenameStamp(period) {
  if (period.period === 'all') return 'all_time';
  if (period.year && period.month) {
    const label = new Date(Date.UTC(period.year, period.month - 1, 1)).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return label.toLowerCase().replace(/\s+/g, '_');
  }
  if (period.from && period.to) {
    const fromKey = typeof period.from === 'string' ? period.from : dateKey(period.from);
    const toKey = typeof period.to === 'string' ? period.to : dateKey(period.to);
    return `${fromKey}_to_${toKey}`;
  }
  return new Date().toISOString().slice(0, 10);
}

async function nextCoachSessionCode(tx = prisma) {
  const day = new Date();
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const d = String(day.getDate()).padStart(2, '0');
  const prefix = `CATT-${y}${m}${d}-`;
  const last = await tx.coachAttendanceSession.findFirst({
    where: { sessionCode: { startsWith: prefix } },
    orderBy: { sessionCode: 'desc' },
    select: { sessionCode: true },
  });
  let n = 1;
  if (last?.sessionCode) {
    const parsed = Number.parseInt(last.sessionCode.slice(prefix.length), 10);
    if (Number.isFinite(parsed)) n = parsed + 1;
  }
  return `${prefix}${String(n).padStart(3, '0')}`;
}

function publicSession(session, { qrPayload, qrDataUrl } = {}) {
  if (!session) return null;
  return {
    id: session.id,
    sessionCode: session.sessionCode,
    status: session.status,
    expiresAt: session.expiresAt,
    usedAt: session.usedAt || null,
    usedByCoachId: session.usedByCoachId || null,
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
    type: 'akhada_coach_attendance',
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

async function createActiveCoachSession(tx, { createdById, ttlSeconds = QR_TTL_SECONDS }) {
  const rawToken = makeRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const sessionCode = await nextCoachSessionCode(tx);
  const session = await tx.coachAttendanceSession.create({
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

async function expireStaleCoachSessions(tx = prisma) {
  const now = new Date();
  await tx.coachAttendanceSession.updateMany({
    where: { status: 'ACTIVE', expiresAt: { lt: now } },
    data: { status: 'EXPIRED', closedAt: now, displayToken: null },
  });
}

/**
 * If desk is open (latest QR was USED/EXPIRED, not CLOSED) and nothing is ACTIVE,
 * mint a replacement QR so admin display keeps rotating — same as student desk.
 */
async function ensureActiveCoachSessionForDesk(createdById) {
  await expireStaleCoachSessions();
  const active = await prisma.coachAttendanceSession.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (active) return active;

  const latest = await prisma.coachAttendanceSession.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });
  if (!latest || latest.status === 'CLOSED') return null;

  const { session } = await prisma.$transaction(async (tx) => {
    await expireStaleCoachSessions(tx);
    const stillActive = await tx.coachAttendanceSession.findFirst({ where: { status: 'ACTIVE' } });
    if (stillActive) {
      return {
        session: await tx.coachAttendanceSession.findFirst({
          where: { id: stillActive.id },
          include: { createdBy: { select: { id: true, name: true } } },
        }),
      };
    }
    const latestInside = await tx.coachAttendanceSession.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    if (!latestInside || latestInside.status === 'CLOSED') return { session: null };
    return createActiveCoachSession(tx, { createdById });
  });
  return session;
}

/** Admin: create new coach QR session (closes previous ACTIVE) — mirrors student generate */
export const generateCoachAttendanceQr = asyncHandler(async (req, res) => {
  const ttlSeconds = Math.min(
    3600,
    Math.max(15, Number(req.body.ttlSeconds) || QR_TTL_SECONDS)
  );

  const { session, rawToken } = await prisma.$transaction(
    async (tx) => {
      await expireStaleCoachSessions(tx);
      await tx.coachAttendanceSession.updateMany({
        where: { status: 'ACTIVE' },
        data: { status: 'CLOSED', closedAt: new Date(), displayToken: null },
      });
      return createActiveCoachSession(tx, { createdById: req.user.id, ttlSeconds });
    },
    { maxWait: 10000, timeout: 20000 }
  );

  const assets = await buildQrAssets(session, rawToken);

  await writeAuditLog({
    userId: req.user.id,
    action: 'coach_attendance_qr_generate',
    entity: 'coach_attendance_session',
    entityId: session.id,
    details: { sessionCode: session.sessionCode, ttlSeconds },
    req,
  });

  res.status(201).json({
    success: true,
    message: 'Coach attendance QR generated',
    data: { session: publicSession(session, assets) },
  });
});

export const getActiveCoachAttendanceQr = asyncHandler(async (req, res) => {
  let session = await ensureActiveCoachSessionForDesk(req.user?.id);
  if (!session) {
    return res.json({ success: true, data: { session: null, ttlSeconds: QR_TTL_SECONDS } });
  }
  // Heal ACTIVE sessions that lost displayToken (QR image would otherwise be blank).
  if (!session.displayToken) {
    const rawToken = makeRawToken();
    session = await prisma.coachAttendanceSession.update({
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

export const closeCoachAttendanceQr = asyncHandler(async (req, res) => {
  await expireStaleCoachSessions();
  const id = req.params.id || req.body.sessionId;
  const where = id ? { id, status: 'ACTIVE' } : { status: 'ACTIVE' };
  const session = await prisma.coachAttendanceSession.findFirst({ where });
  if (!session) throw new ApiError(404, 'No active coach attendance QR is available.');

  const updated = await prisma.coachAttendanceSession.update({
    where: { id: session.id },
    data: { status: 'CLOSED', closedAt: new Date(), displayToken: null },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  await writeAuditLog({
    userId: req.user.id,
    action: 'coach_attendance_qr_close',
    entity: 'coach_attendance_session',
    entityId: updated.id,
    details: { sessionCode: updated.sessionCode },
    req,
  });

  res.json({
    success: true,
    message: 'Coach attendance QR closed',
    data: { session: publicSession(updated) },
  });
});

export const getCoachAttendanceStats = asyncHandler(async (req, res) => {
  let date;
  if (req.query.date) {
    try {
      date = parseDateOnly(req.query.date);
    } catch {
      throw new ApiError(400, 'Invalid date. Use YYYY-MM-DD');
    }
  }
  const data = await calculateTodayCoachStats({ date });
  res.json({ success: true, data });
});

export const listCoachAttendanceMonths = asyncHandler(async (_req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT date_trunc('month', date)::date AS month
    FROM coach_attendance
    ORDER BY month DESC
  `;
  const map = new Map();
  for (const r of rows || []) {
    const d = new Date(r.month);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
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
  // Always include current month for empty datasets
  const now = todayParts();
  const curKey = `${now.y}-${String(now.m).padStart(2, '0')}`;
  if (!map.has(curKey)) {
    map.set(curKey, {
      year: now.y,
      month: now.m,
      label: new Intl.DateTimeFormat('en-IN', {
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      }).format(new Date()),
    });
  }
  res.json({ success: true, data: { months: [...map.values()] } });
});

function todayParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month') };
}

export const listCoachAttendanceRecords = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const matrix = await buildCoachAttendanceMatrix(req.query);
  const paged = paginateRows(matrix.rows, page, limit);
  res.json({
    success: true,
    data: {
      view: 'matrix',
      period: matrix.period,
      summary: matrix.summary,
      records: paged.rows.map((r) => ({
        id: `${r.coachId}_${r.date}`,
        date: r.date,
        markedAt: r.markedAt,
        status: r.status.toLowerCase() === 'present' ? 'present' : 'absent',
        statusLabel: r.status,
        registrationId: r.coachCode,
        coachCode: r.coachCode,
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
          id: r.coachId,
          fullName: r.coachName,
          fatherName: r.fatherName,
          registrationNumber: r.coachCode,
        },
        coach: {
          id: r.coachId,
          fullName: r.coachName,
          fatherName: r.fatherName,
          coachCode: r.coachCode,
        },
      })),
      pagination: paged.pagination,
    },
  });
});

export const getCoachAttendanceSummaryList = asyncHandler(async (req, res) => {
  const calc = await calculateCoachAttendanceSummary(req.query);
  let rows = calc.coaches.map((s) => ({
    studentId: s.coachId,
    coachId: s.coachId,
    registrationId: s.coachCode,
    coachCode: s.coachCode,
    fullName: s.fullName,
    fatherName: s.fatherName,
    trainingDays: s.trainingDays,
    present: s.presentDays,
    presentDays: s.presentDays,
    absent: s.absentDays,
    absentDays: s.absentDays,
    attendanceRate: s.attendancePercentage,
    attendancePercentage: s.attendancePercentage,
  }));
  rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
  res.json({
    success: true,
    data: {
      period: calc.period,
      trainingDays: calc.summary.trainingDays,
      summary: calc.summary,
      students: rows,
      coaches: rows,
    },
  });
});

export const getCoachHistory = asyncHandler(async (req, res) => {
  const data = await getCoachAttendanceHistory(req.params.coachId, req.query);
  if (!data) throw new ApiError(404, 'Coach not found');
  res.json({ success: true, data });
});

export const exportCoachAttendanceExcel = asyncHandler(async (req, res) => {
  const input = { ...req.query, ...req.body };
  const reportType = String(input.reportType || 'matrix').toLowerCase();
  const period = safeResolvePeriod(input);

  if (reportType === 'summary') {
    const calc = await calculateCoachAttendanceSummary(input);
    const rows = calc.coaches
      .map((r) => ({
        registrationId: r.coachCode,
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
      { key: 'registrationId', label: 'Coach ID', width: 16 },
      { key: 'studentName', label: 'Coach Name', width: 22 },
      { key: 'fatherName', label: 'Father Name', width: 20 },
      { key: 'trainingDays', label: 'Total Days', width: 12 },
      { key: 'present', label: 'Present', width: 10 },
      { key: 'absent', label: 'Absent', width: 10 },
      { key: 'attendanceRate', label: 'Attendance %', width: 14 },
    ];
    const buffer = await toXlsxBuffer(rows, columns, { sheetName: 'Coach Summary' });
    const stamp = exportFilenameStamp({ ...period, ...calc.period });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="raghunandan_akhada_coach_attendance_${stamp}_summary.xlsx"`
    );
    return res.send(buffer);
  }

  const matrix = await buildCoachAttendanceMatrix(input);
  const dailySorted = [...matrix.rows].sort((a, b) => {
    if (a.date === b.date) return a.studentName.localeCompare(b.studentName);
    return a.date < b.date ? -1 : 1;
  });
  const dailyRows = dailySorted.map((r, i) => ({
    serial: i + 1,
    registrationId: r.coachCode,
    studentName: r.coachName,
    fatherName: r.fatherName,
    batch: r.batch,
    membershipType: '',
    dateDisplay: r.dateDisplay,
    status: r.status,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    sourceLabel: r.sourceLabel || (r.status === 'Present' ? 'QR' : '—'),
    distanceLabel: r.distanceLabel || '—',
    locationLabel: r.locationLabel || '—',
  }));
  const summaryRows = matrix.coaches
    .map((r) => ({
      registrationId: r.coachCode,
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
    title: `Kuldeep Malik Sports Academy Coach Attendance — ${stamp}`,
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="raghunandan_akhada_coach_attendance_${stamp}.xlsx"`
  );
  return res.send(buffer);
});

/**
 * Coach self-scan — identity from JWT coachId only (never trust body coachId).
 * Scans admin-displayed coach QR (type: akhada_coach_attendance).
 */
export const scanCoachAttendance = asyncHandler(async (req, res) => {
  const coachId = req.user?.coachId;
  if (!coachId) throw new ApiError(403, 'Coach account is not linked.');

  const coach = await prisma.coach.findUnique({ where: { id: coachId } });
  if (!coach) throw new ApiError(404, 'Coach not found');
  if (coach.status !== 'Active') {
    throw new ApiError(403, 'Your account is currently inactive. Please contact the administrator.');
  }

  let payload = req.body?.payload ?? req.body?.qrData ?? req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new ApiError(
        400,
        'Invalid Coach Attendance QR.\nPlease scan the current QR displayed by the admin.',
        'QR_INVALID'
      );
    }
  }

  if (payload?.type === 'akhada_attendance') {
    throw new ApiError(
      400,
      'Student QR cannot be used for coach attendance.\nPlease scan the coach attendance QR.',
      'WRONG_ATTENDANCE_TYPE'
    );
  }

  const sessionId = payload?.sessionId;
  const token = payload?.token;
  if (!sessionId || !token || payload?.type !== 'akhada_coach_attendance') {
    throw new ApiError(
      400,
      'Invalid Coach Attendance QR.\nPlease scan the current QR displayed by the admin.',
      'QR_INVALID'
    );
  }

  const geo = await assertQrGeofence({
    latitude: req.body?.latitude ?? payload?.latitude,
    longitude: req.body?.longitude ?? payload?.longitude,
    accuracy: req.body?.accuracy ?? req.body?.gpsAccuracy ?? payload?.accuracy,
    timestamp: req.body?.timestamp ?? payload?.timestamp,
  });

  const tokenHash = hashToken(token);
  const markedAt = new Date();
  const date = attendanceDateFromInstant(markedAt);

  const alreadyToday = await prisma.coachAttendance.findFirst({
    where: { coachId: coach.id, date },
    select: { id: true },
  });
  if (alreadyToday) {
    throw new ApiError(409, 'Your attendance for today has already been marked.', 'ATTENDANCE_ALREADY_MARKED');
  }

  const existingSession = await prisma.coachAttendanceSession.findUnique({ where: { id: sessionId } });
  if (!existingSession) {
    throw new ApiError(
      400,
      'Invalid Coach Attendance QR.\nPlease scan the current QR displayed by the admin.',
      'QR_INVALID'
    );
  }
  if (existingSession.tokenHash !== tokenHash && existingSession.displayToken !== token) {
    throw new ApiError(
      400,
      'Invalid Coach Attendance QR.\nPlease scan the current QR displayed by the admin.',
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
      'No active coach attendance QR is available.\nPlease contact the Academy administrator.',
      'QR_CLOSED'
    );
  }
  if (existingSession.status === 'EXPIRED' || existingSession.expiresAt < new Date()) {
    if (existingSession.status === 'ACTIVE') {
      await prisma.coachAttendanceSession.updateMany({
        where: { id: existingSession.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED', closedAt: new Date(), displayToken: null },
      });
    }
    throw new ApiError(400, 'This coach attendance QR has expired.\nPlease scan the new QR.', 'QR_EXPIRED');
  }

  const createdById = existingSession.createdById || null;
  let record;
  let usedSessionCode = existingSession.sessionCode;

  try {
    const core = await prisma.$transaction(
      async (tx) => {
        const alreadyInTx = await tx.coachAttendance.findFirst({
          where: { coachId: coach.id, date },
          select: { id: true },
        });
        if (alreadyInTx) {
          throw new ApiError(409, 'Your attendance for today has already been marked.', 'ATTENDANCE_ALREADY_MARKED');
        }

        const claimed = await tx.coachAttendanceSession.updateMany({
          where: {
            id: existingSession.id,
            status: 'ACTIVE',
            tokenHash,
            expiresAt: { gt: new Date() },
          },
          data: {
            status: 'USED',
            usedAt: markedAt,
            usedByCoachId: coach.id,
            displayToken: null,
          },
        });
        if (claimed.count !== 1) {
          const fresh = await tx.coachAttendanceSession.findUnique({ where: { id: existingSession.id } });
          if (fresh?.status === 'USED') {
            throw new ApiError(
              409,
              'This QR code has already been used. Please scan the new QR code.',
              'QR_ALREADY_USED'
            );
          }
          if (fresh?.status === 'EXPIRED') {
            throw new ApiError(400, 'This coach attendance QR has expired.\nPlease scan the new QR.', 'QR_EXPIRED');
          }
          throw new ApiError(400, 'Please scan the new QR displayed by the admin.', 'QR_REPLACED');
        }

        try {
          return await tx.coachAttendance.create({
            data: {
              coachId: coach.id,
              attendanceSessionId: existingSession.id,
              coachCode: coach.coachCode,
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
        } catch (err) {
          if (err?.code === 'P2002') {
            throw new ApiError(409, 'Your attendance for today has already been marked.', 'ATTENDANCE_ALREADY_MARKED');
          }
          throw err;
        }
      },
      { maxWait: 10000, timeout: 20000 }
    );
    record = core;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw err;
  }

  // Rotate next coach QR for admin desk
  let nextSession = null;
  let nextToken = null;
  try {
    const created = await prisma.$transaction(
      (tx) => createActiveCoachSession(tx, { createdById }),
      { maxWait: 10000, timeout: 20000 }
    );
    nextSession = created.session;
    nextToken = created.rawToken;
  } catch {
    /* ignore */
  }

  const nextAssets =
    nextSession && nextToken ? await buildQrAssets(nextSession, nextToken) : { qrPayload: null, qrDataUrl: null };

  await writeAuditLog({
    userId: req.user.id,
    action: 'coach_attendance_scan',
    entity: 'coach_attendance',
    entityId: record.id,
    details: { coachCode: coach.coachCode, sessionCode: usedSessionCode },
    req,
  });

  res.status(201).json({
    success: true,
    message: 'Attendance Marked Successfully',
    data: {
      attendance: {
        id: record.id,
        coachName: coach.fullName,
        name: coach.fullName,
        type: 'Coach',
        coachCode: coach.coachCode,
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
