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
  getDailyCoachRoster,
  paginateRows,
} from '../services/coachAttendanceCalc.js';
import { resolvePeriodFilter } from '../services/attendanceCalc.js';
import { upsertCoachAttendanceStatus } from '../services/attendanceMarkService.js';
import { normalizeAttendanceStatus } from '../constants/attendanceStatus.js';

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
        status: r.statusKey || normalizeAttendanceStatus(r.status) || 'absent',
        statusKey: r.statusKey || normalizeAttendanceStatus(r.status) || 'absent',
        statusLabel: r.statusLabel || r.status,
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
    leave: s.leaveDays ?? 0,
    leaveDays: s.leaveDays ?? 0,
    medicalLeave: s.medicalLeaveDays ?? 0,
    competitionLeave: s.competitionLeaveDays ?? 0,
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
    sourceLabel: r.sourceLabel && r.sourceLabel !== 'QR' ? r.sourceLabel : r.status === 'Present' ? 'Manual' : '—',
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

export const listCoachDailyRoster = asyncHandler(async (req, res) => {
  if (!req.query.date) throw new ApiError(400, 'date is required (YYYY-MM-DD)');
  try {
    parseDateOnly(req.query.date);
  } catch {
    throw new ApiError(400, 'Invalid date. Use YYYY-MM-DD');
  }
  const data = await getDailyCoachRoster(req.query);
  res.json({ success: true, data });
});

export const markCoachAttendanceStatus = asyncHandler(async (req, res) => {
  const coachId = req.body.coachId || req.body.employeeId;
  const date = req.body.date;
  const status = req.body.status;
  if (!coachId) throw new ApiError(400, 'coachId is required');
  if (!date) throw new ApiError(400, 'date is required (YYYY-MM-DD)');
  if (!status) throw new ApiError(400, 'status is required');

  const result = await upsertCoachAttendanceStatus({
    coachId,
    date,
    status,
    markedAt: req.body.markedAt ? new Date(req.body.markedAt) : new Date(),
    method: 'MANUAL',
  });

  await writeAuditLog({
    userId: req.user.id,
    action: 'coach_attendance_mark_status',
    entity: 'coach_attendance',
    entityId: result.record.id,
    details: { coachId, date: result.date, status: result.status },
    req,
  });

  res.json({
    success: true,
    message: `Attendance marked as ${result.statusLabel}`,
    data: {
      record: result.record,
      date: result.date,
      status: result.status,
      statusLabel: result.statusLabel,
      coach: result.person,
    },
  });
});

