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
import {
  attendanceStatusLabel,
  normalizeAttendanceStatus,
} from '../constants/attendanceStatus.js';
import { upsertStudentAttendanceStatus } from '../services/attendanceMarkService.js';

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
  const statusKey = normalizeAttendanceStatus(input.status);
  if (statusKey) where.status = statusKey;
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
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT date_trunc('month', date)::date AS month
    FROM attendance
    ORDER BY month DESC
  `;
  const months = (rows || []).map((r) => {
    const d = new Date(r.month);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    return {
      year: y,
      month: m,
      label: new Intl.DateTimeFormat('en-IN', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d),
    };
  });
  res.json({ success: true, data: { months } });
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
          id: r.id || `${r.studentId}_${r.date}`,
          recordId: r.id || null,
          date: r.date,
          markedAt: r.markedAt,
          status: r.statusKey || normalizeAttendanceStatus(r.status) || 'absent',
          statusLabel: r.statusLabel || attendanceStatusLabel(r.status) || r.status,
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
      view: 'records',
      period: calc.period,
      summary: calc.summary,
      records: withIds(
        rows.map((r) => ({
          id: r.id,
          date: dateKey(r.date),
          markedAt: r.markedAt,
          status: r.status,
          statusLabel: attendanceStatusLabel(r.status),
          registrationId: r.registrationId,
          sessionCode: r.session?.sessionCode,
          attendanceSessionId: r.attendanceSessionId,
          source: r.source || r.session?.source || 'live',
          method: r.method || 'MANUAL',
          sourceLabel:
            String(r.method || 'MANUAL').toUpperCase() === 'BIOMETRIC'
              ? 'Biometric'
              : String(r.method || 'MANUAL').toUpperCase() === 'MANUAL'
                ? 'Manual'
                : 'Manual',
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
    leave: s.leaveDays,
    leaveDays: s.leaveDays,
    medicalLeave: s.medicalLeaveDays,
    medicalLeaveDays: s.medicalLeaveDays,
    competitionLeave: s.competitionLeaveDays,
    competitionLeaveDays: s.competitionLeaveDays,
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
        leave: r.leaveDays,
        medicalLeave: r.medicalLeaveDays,
        competitionLeave: r.competitionLeaveDays,
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
      { key: 'leave', label: 'Leave', width: 10 },
      { key: 'medicalLeave', label: 'Medical Leave', width: 14 },
      { key: 'competitionLeave', label: 'Competition Leave', width: 16 },
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
      sourceLabel: r.sourceLabel || (r.status === 'Present' ? 'Manual' : '—'),
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
        leave: r.leaveDays,
        medicalLeave: r.medicalLeaveDays,
        competitionLeave: r.competitionLeaveDays,
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
    status: attendanceStatusLabel(r.status),
    sessionCode: r.session?.sessionCode || '',
  }));

  const buffer = await toXlsxBuffer(rows, columns, { sheetName: 'Attendance Records', colorStatus: true });
  const stamp = exportFilenameStamp(period);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="raghunandan_akhada_attendance_records_${stamp.toLowerCase()}.xlsx"`);
  return res.send(buffer);
});

export const markAttendanceStatus = asyncHandler(async (req, res) => {
  const studentId = req.body.studentId || req.body.playerId;
  const date = req.body.date;
  const status = req.body.status;
  if (!studentId) throw new ApiError(400, 'studentId is required');
  if (!date) throw new ApiError(400, 'date is required (YYYY-MM-DD)');
  if (!status) throw new ApiError(400, 'status is required');

  const result = await upsertStudentAttendanceStatus({
    studentId,
    date,
    status,
    sessionSlot: req.body.sessionSlot || req.body.session,
    markedAt: req.body.markedAt ? new Date(req.body.markedAt) : new Date(),
    method: 'MANUAL',
  });
  await refreshStudentAttendanceCounters(studentId);

  await writeAuditLog({
    userId: req.user.id,
    action: 'attendance_mark_status',
    entity: 'attendance',
    entityId: result.record.id,
    details: { studentId, date: result.date, status: result.status },
    req,
  });

  res.json({
    success: true,
    message: `Attendance marked as ${result.statusLabel}`,
    data: {
      record: withId(result.record),
      date: result.date,
      status: result.status,
      statusLabel: result.statusLabel,
      student: result.person,
    },
  });
});

export const getMyAttendance = asyncHandler(async (req, res) => {
  const studentId = req.user.studentId;
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw new ApiError(404, 'Student not found');

  const periodInput = Object.keys(req.query || {}).length ? req.query : { period: 'month' };
  const [calcMonth, calcAll, history] = await Promise.all([
    calculateStudentAttendance(studentId, periodInput),
    calculateStudentAttendance(studentId, { period: 'all' }),
    getStudentAttendanceHistory(studentId, periodInput),
  ]);

  const calc = calcMonth || calcAll;
  res.json({
    success: true,
    data: {
      summary: {
        present: calc?.presentDays || 0,
        absent: calc?.absentDays || 0,
        leave: calc?.leaveDays || 0,
        medicalLeave: calc?.medicalLeaveDays || 0,
        competitionLeave: calc?.competitionLeaveDays || 0,
        totalDays: calc?.trainingDays || 0,
        trainingDays: calc?.trainingDays || 0,
        presentDays: calc?.presentDays || 0,
        absentDays: calc?.absentDays || 0,
        leaveDays: calc?.leaveDays || 0,
        medicalLeaveDays: calc?.medicalLeaveDays || 0,
        competitionLeaveDays: calc?.competitionLeaveDays || 0,
        attendanceRate: calc?.attendancePercentage || 0,
        attendancePercentage: calc?.attendancePercentage || 0,
        allTimePercentage: calcAll?.attendancePercentage || 0,
      },
      period: history?.period || null,
      records: (history?.history || []).map((r) => ({
        id: r.id || `${r.studentId}_${r.date}`,
        date: r.date,
        time: r.checkIn || '',
        status: r.statusKey || normalizeAttendanceStatus(r.status) || 'absent',
        statusLabel: r.statusLabel || attendanceStatusLabel(r.status) || r.status,
        sessionCode: r.sessionCode || null,
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
  // Never expose internal admin notes on the player portal
  const { adminNotes, ...safe } = student;
  res.json({ success: true, data: { student: withId(safe) } });
});
