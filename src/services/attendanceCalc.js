import prisma from '../config/db.js';
import {
  attendanceStatusLabel,
  normalizeAttendanceStatus,
} from '../constants/attendanceStatus.js';
import {
  attendanceDateFromInstant,
  countTrainingDates,
  currentMonthBoundsIST,
  dateKey,
  effectivePeriodEnd,
  listTrainingDates,
  maxDate,
  minDate,
  monthBounds,
  parseDateOnly,
  pct2,
  toDateOnly,
  todayISTDateOnly,
} from '../utils/attendanceDate.js';

let scheduleCache = { at: 0, keys: null };

/** Active non-holiday weekday keys from ScheduleDay (fallback Mon–Sat). */
export async function getTrainingDayKeys({ force = false } = {}) {
  const now = Date.now();
  if (!force && scheduleCache.keys && now - scheduleCache.at < 60_000) {
    return scheduleCache.keys;
  }
  const days = await prisma.scheduleDay.findMany({
    where: { isActive: true, isHoliday: false },
    select: { dayKey: true },
  });
  const keys = new Set(
    (days.length
      ? days.map((d) => String(d.dayKey).toLowerCase())
      : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])
  );
  scheduleCache = { at: now, keys };
  return keys;
}

export function resolvePeriodFilter(input = {}, now = new Date()) {
  const period = String(input.period || 'month').toLowerCase();
  if (period === 'all' || period === 'all_time') {
    return { period: 'all', from: null, to: null };
  }
  if (period === 'custom' || period === 'range') {
    if (!input.from || !input.to) {
      const err = new Error('From and To dates are required for custom range');
      err.statusCode = 400;
      throw err;
    }
    return {
      period: 'custom',
      from: parseDateOnly(input.from),
      to: parseDateOnly(input.to),
    };
  }
  if (period === 'select' || (input.year && input.month)) {
    const { from, to } = monthBounds(input.year, input.month);
    return {
      period: 'select',
      from,
      to,
      year: Number(input.year),
      month: Number(input.month),
    };
  }
  const { from, to } = currentMonthBoundsIST(now);
  return {
    period: 'month',
    from,
    to,
    year: from.getUTCFullYear(),
    month: from.getUTCMonth() + 1,
  };
}

/**
 * Resolve concrete [from, to] for calculations.
 * Caps end at today IST. For All Time, uses earliest joining/attendance → today.
 */
export async function resolveCalcWindow(period, { now = new Date() } = {}) {
  const today = todayISTDateOnly(now);
  if (period.period === 'all' || (!period.from && !period.to)) {
    const [earliestJoin, earliestAtt] = await Promise.all([
      prisma.student.findFirst({
        where: { status: { in: ['Active', 'Inactive', 'Suspended'] } },
        orderBy: { joiningDate: 'asc' },
        select: { joiningDate: true },
      }),
      prisma.attendance.findFirst({
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);
    const candidates = [
      toDateOnly(earliestJoin?.joiningDate),
      toDateOnly(earliestAtt?.date),
      today,
    ].filter(Boolean);
    const from = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
    return { from, to: today, cappedToToday: true };
  }
  const from = toDateOnly(period.from);
  const rawTo = toDateOnly(period.to);
  const to = effectivePeriodEnd(rawTo, now);
  return { from, to, cappedToToday: to.getTime() < rawTo.getTime() };
}

function studentSearchWhere(search) {
  const q = String(search || '').trim();
  if (!q) return {};
  const or = [
    { registrationNumber: { contains: q, mode: 'insensitive' } },
    { fullName: { contains: q, mode: 'insensitive' } },
    { fatherName: { contains: q, mode: 'insensitive' } },
  ];
  if (/^[0-9a-f-]{36}$/i.test(q)) or.unshift({ id: q });
  return { OR: or };
}

const STUDENT_SELECT = {
  id: true,
  fullName: true,
  registrationNumber: true,
  joiningDate: true,
  status: true,
  fatherName: true,
  mobileNumber: true,
  batch: true,
  membershipType: true,
};

/**
 * Students applicable for expected attendance in [from, to].
 * - Active students with joiningDate <= period end
 * - Plus any student who has attendance in the window (keeps historical/demo consistent)
 */
export async function loadApplicableStudents({ from, to, search } = {}) {
  const searchWhere = studentSearchWhere(search);

  const [active, attended] = await Promise.all([
    prisma.student.findMany({
      where: {
        status: 'Active',
        joiningDate: { lte: to },
        ...searchWhere,
      },
      select: STUDENT_SELECT,
      orderBy: { fullName: 'asc' },
    }),
    prisma.attendance.findMany({
      where: {
        date: { gte: from, lte: to },
        student: {
          joiningDate: { lte: to },
          ...searchWhere,
        },
      },
      distinct: ['studentId'],
      select: {
        student: {
          select: STUDENT_SELECT,
        },
      },
    }),
  ]);

  const map = new Map(active.map((s) => [s.id, s]));
  for (const row of attended) {
    if (row.student && !map.has(row.student.id)) map.set(row.student.id, row.student);
  }
  return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Unique present dates per studentId within [from, to]. */
export async function loadPresentDateMap({ from, to, studentIds } = {}) {
  const statusMap = await loadAttendanceStatusMap({ from, to, studentIds });
  const map = new Map();
  for (const [studentId, byDate] of statusMap.entries()) {
    const set = new Set();
    for (const [key, status] of byDate.entries()) {
      if (status === 'present') set.add(key);
    }
    map.set(studentId, set);
  }
  return map;
}

/**
 * Map studentId → Map(dateKey → status key).
 * One status per student/day (earliest markedAt wins for extras).
 */
export async function loadAttendanceStatusMap({ from, to, studentIds } = {}) {
  const where = {
    date: { gte: from, lte: to },
  };
  if (studentIds?.length) where.studentId = { in: studentIds };

  const rows = await prisma.attendance.findMany({
    where,
    select: {
      studentId: true,
      date: true,
      status: true,
      markedAt: true,
      method: true,
      source: true,
      distanceFromAkhada: true,
      locationVerified: true,
      gpsAccuracy: true,
      session: { select: { sessionCode: true } },
    },
    orderBy: { markedAt: 'asc' },
  });

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.studentId)) map.set(r.studentId, new Map());
    const byDate = map.get(r.studentId);
    const key = dateKey(r.date);
    if (byDate.has(key)) continue;
    const status = normalizeAttendanceStatus(r.status) || 'present';
    byDate.set(key, status);
  }
  return map;
}

export function calcStudentRow(student, { from, to, trainingDayKeys, presentDates, statusByDate }) {
  const join = toDateOnly(student.joiningDate) || from;
  const studentFrom = maxDate(from, join);
  const studentTo = to;
  const trainingDays =
    studentFrom.getTime() <= studentTo.getTime()
      ? countTrainingDates(studentFrom, studentTo, trainingDayKeys)
      : 0;

  let presentDays = 0;
  let leaveDays = 0;
  let medicalLeaveDays = 0;
  let competitionLeaveDays = 0;

  if (statusByDate?.size) {
    for (const [key, status] of statusByDate.entries()) {
      const d = parseDateOnly(key);
      if (d.getTime() < studentFrom.getTime() || d.getTime() > studentTo.getTime()) continue;
      if (status === 'present') presentDays += 1;
      else if (status === 'leave') leaveDays += 1;
      else if (status === 'medical_leave') medicalLeaveDays += 1;
      else if (status === 'competition_leave') competitionLeaveDays += 1;
      else if (status === 'absent') {
        /* counted via formula below */
      }
    }
  } else if (presentDates?.size) {
    for (const key of presentDates) {
      const d = parseDateOnly(key);
      if (d.getTime() >= studentFrom.getTime() && d.getTime() <= studentTo.getTime()) {
        presentDays += 1;
      }
    }
  }

  presentDays = Math.min(presentDays, trainingDays || presentDays);
  const excusedDays = leaveDays + medicalLeaveDays + competitionLeaveDays;
  const accountableDays = Math.max(0, trainingDays - excusedDays);
  const absentDays = Math.max(0, accountableDays - presentDays);
  const attendancePercentage = pct2(presentDays, accountableDays || 0);

  return {
    studentId: student.id,
    registrationId: student.registrationNumber,
    fullName: student.fullName,
    fatherName: student.fatherName || '',
    mobileNumber: student.mobileNumber || '',
    batch: student.batch || '',
    membershipType: student.membershipType || '',
    status: student.status,
    joiningDate: dateKey(join),
    trainingDays,
    presentDays,
    absentDays,
    leaveDays,
    medicalLeaveDays,
    competitionLeaveDays,
    excusedDays,
    accountableDays,
    attendancePercentage,
    present: presentDays,
    absent: absentDays,
    leave: leaveDays,
    medicalLeave: medicalLeaveDays,
    competitionLeave: competitionLeaveDays,
    attendanceRate: attendancePercentage,
  };
}

/**
 * Overall + per-student attendance for a period.
 * Present/absent are STUDENT+DATE based, never raw QR/session row counts.
 */
export async function calculateAttendanceSummary(input = {}, { now = new Date() } = {}) {
  const period = resolvePeriodFilter(input, now);
  const window = await resolveCalcWindow(period, { now });
  const { from, to } = window;
  const trainingDayKeys = await getTrainingDayKeys();
  const search = input.search || input.student || '';

  const students = await loadApplicableStudents({ from, to, search });
  const statusMap = await loadAttendanceStatusMap({
    from,
    to,
    studentIds: students.map((s) => s.id),
  });

  const studentRows = students.map((s) =>
    calcStudentRow(s, {
      from,
      to,
      trainingDayKeys,
      statusByDate: statusMap.get(s.id),
    })
  );

  const trainingDaysCalendar = countTrainingDates(from, to, trainingDayKeys);
  const expectedStudentDays = studentRows.reduce((sum, r) => sum + r.trainingDays, 0);
  const presentStudentDays = studentRows.reduce((sum, r) => sum + r.presentDays, 0);
  const absentStudentDays = studentRows.reduce((sum, r) => sum + r.absentDays, 0);
  const leaveStudentDays = studentRows.reduce((sum, r) => sum + r.leaveDays, 0);
  const medicalLeaveStudentDays = studentRows.reduce((sum, r) => sum + r.medicalLeaveDays, 0);
  const competitionLeaveStudentDays = studentRows.reduce((sum, r) => sum + r.competitionLeaveDays, 0);
  const excusedStudentDays = leaveStudentDays + medicalLeaveStudentDays + competitionLeaveStudentDays;
  const accountableStudentDays = Math.max(0, expectedStudentDays - excusedStudentDays);
  const attendancePercentage = pct2(presentStudentDays, accountableStudentDays);

  const studentIds = students.map((s) => s.id);
  const rawWhere = {
    date: { gte: from, lte: to },
  };
  if (studentIds.length) rawWhere.studentId = { in: studentIds };
  if (search) {
    rawWhere.OR = [
      { registrationId: { contains: String(search).trim(), mode: 'insensitive' } },
      { student: { fullName: { contains: String(search).trim(), mode: 'insensitive' } } },
    ];
  }
  const rawScanRecords = await prisma.attendance.count({ where: rawWhere });

  return {
    period: {
      ...period,
      from: dateKey(from),
      to: dateKey(to),
      cappedToToday: window.cappedToToday,
    },
    summary: {
      totalStudents: students.length,
      trainingDays: trainingDaysCalendar,
      expectedStudentDays,
      presentStudentDays,
      absentStudentDays,
      leaveStudentDays,
      medicalLeaveStudentDays,
      competitionLeaveStudentDays,
      excusedStudentDays,
      accountableStudentDays,
      attendancePercentage,
      // UI-friendly aliases
      present: presentStudentDays,
      absent: absentStudentDays,
      leave: leaveStudentDays,
      medicalLeave: medicalLeaveStudentDays,
      competitionLeave: competitionLeaveStudentDays,
      attendanceRate: attendancePercentage,
      rawScanRecords,
      uniqueAttendanceDays: presentStudentDays,
      totalRecords: rawScanRecords,
    },
    students: studentRows,
  };
}

export async function calculateStudentAttendance(studentId, input = {}, { now = new Date() } = {}) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;

  const period = resolvePeriodFilter(
    Object.keys(input).length ? input : { period: 'all' },
    now
  );
  const window = await resolveCalcWindow(period, { now });
  const trainingDayKeys = await getTrainingDayKeys();
  const statusMap = await loadAttendanceStatusMap({
    from: window.from,
    to: window.to,
    studentIds: [studentId],
  });

  return calcStudentRow(student, {
    from: window.from,
    to: window.to,
    trainingDayKeys,
    statusByDate: statusMap.get(studentId),
  });
}

/** Today's dashboard stats — unique active students by status. */
export async function calculateTodayStats({ date, now = new Date() } = {}) {
  let day;
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    day = toDateOnly(date);
  } else if (date) {
    day = parseDateOnly(date);
  } else {
    day = attendanceDateFromInstant(now);
  }
  const totalStudents = await prisma.student.count({ where: { status: 'Active' } });

  const dayRows = await prisma.attendance.findMany({
    where: { date: day, student: { status: 'Active' } },
    select: { studentId: true, status: true, method: true, markedAt: true },
    orderBy: { markedAt: 'asc' },
  });

  const byStudent = new Map();
  for (const r of dayRows) {
    if (byStudent.has(r.studentId)) continue;
    byStudent.set(r.studentId, {
      status: normalizeAttendanceStatus(r.status) || 'present',
      method: r.method,
    });
  }

  let present = 0;
  let leave = 0;
  let medicalLeave = 0;
  let competitionLeave = 0;
  let markedAbsent = 0;
  let qrAttendance = 0;
  let biometricAttendance = 0;
  let manualAttendance = 0;

  for (const row of byStudent.values()) {
    if (row.status === 'present') {
      present += 1;
      const m = String(row.method || 'QR').toUpperCase();
      if (m === 'BIOMETRIC') biometricAttendance += 1;
      else if (m === 'MANUAL') manualAttendance += 1;
      else qrAttendance += 1;
    } else if (row.status === 'leave') leave += 1;
    else if (row.status === 'medical_leave') medicalLeave += 1;
    else if (row.status === 'competition_leave') competitionLeave += 1;
    else if (row.status === 'absent') markedAbsent += 1;
  }

  const excused = leave + medicalLeave + competitionLeave;
  const absent = Math.max(0, totalStudents - present - excused - markedAbsent) + markedAbsent;
  const accountable = present + absent;
  const attendancePercentage = pct2(present, accountable);

  return {
    date: dateKey(day),
    totalStudents,
    present,
    absent,
    leave,
    medicalLeave,
    competitionLeave,
    attendanceRate: attendancePercentage,
    attendancePercentage,
    qrAttendance,
    biometricAttendance,
    manualAttendance,
  };
}

export async function refreshStudentAttendanceCounters(studentId, { now = new Date() } = {}) {
  const row = await calculateStudentAttendance(studentId, { period: 'all' }, { now });
  if (!row) return null;
  await prisma.student.update({
    where: { id: studentId },
    data: {
      attendancePresent: row.presentDays,
      attendanceAbsent: row.absentDays,
      attendanceTotal: row.trainingDays,
    },
  });
  return row;
}

function formatIstTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function formatIstDateDisplay(d) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Earliest attendance mark per studentId+date (any status). */
async function loadCheckInMap({ from, to, studentIds } = {}) {
  const where = {
    date: { gte: from, lte: to },
  };
  if (studentIds?.length) where.studentId = { in: studentIds };

  const rows = await prisma.attendance.findMany({
    where,
    select: {
      id: true,
      studentId: true,
      date: true,
      status: true,
      markedAt: true,
      method: true,
      source: true,
      distanceFromAkhada: true,
      locationVerified: true,
      gpsAccuracy: true,
      session: { select: { sessionCode: true } },
    },
    orderBy: { markedAt: 'asc' },
  });

  const map = new Map();
  for (const r of rows) {
    const key = `${r.studentId}|${dateKey(r.date)}`;
    if (!map.has(key)) {
      const method = String(r.method || 'QR').toUpperCase();
      const statusKey = normalizeAttendanceStatus(r.status) || 'present';
      map.set(key, {
        id: r.id,
        statusKey,
        statusLabel: attendanceStatusLabel(statusKey),
        markedAt: r.markedAt,
        checkIn: formatIstTime(r.markedAt),
        sessionCode: r.session?.sessionCode || '',
        method,
        source: r.source || 'live',
        sourceLabel: method === 'BIOMETRIC' ? 'Biometric' : method === 'MANUAL' ? 'Manual' : 'QR',
        distanceFromAkhada: r.distanceFromAkhada,
        locationVerified: r.locationVerified,
        gpsAccuracy: r.gpsAccuracy,
      });
    }
  }
  return map;
}

/**
 * Full attendance matrix: every applicable training date × every applicable student.
 * Missing DB row ⇒ Absent. Stored leave types keep their status. Duplicate same-day ⇒ once.
 */
export async function buildAttendanceMatrix(input = {}, { now = new Date() } = {}) {
  const period = resolvePeriodFilter(input, now);
  const window = await resolveCalcWindow(period, { now });
  const { from, to } = window;
  const trainingDayKeys = await getTrainingDayKeys();
  const search = input.search || input.student || '';
  const statusFilter = normalizeAttendanceStatus(input.status) || String(input.status || 'all').toLowerCase();
  const methodFilter = String(input.method || input.sourceMethod || 'all').toUpperCase();
  const locationFilter = String(input.location || input.locationVerified || 'all').toLowerCase();

  const students = await loadApplicableStudents({ from, to, search });
  const dates = listTrainingDates(from, to, trainingDayKeys);
  const studentIds = students.map((s) => s.id);
  const checkInMap = await loadCheckInMap({ from, to, studentIds });

  const rows = [];
  for (const day of dates) {
    const dayKeyStr = dateKey(day);
    for (const student of students) {
      const join = toDateOnly(student.joiningDate) || from;
      if (join.getTime() > day.getTime()) continue;

      const hit = checkInMap.get(`${student.id}|${dayKeyStr}`);
      const statusKey = hit?.statusKey || 'absent';
      const statusLabel = hit?.statusLabel || attendanceStatusLabel('absent');
      if (statusFilter !== 'all' && statusKey !== statusFilter) continue;
      if (methodFilter && methodFilter !== 'ALL') {
        if (!hit || String(hit.method || 'QR').toUpperCase() !== methodFilter) continue;
      }
      if (locationFilter === 'verified') {
        if (!hit || hit.locationVerified !== true) continue;
      }
      if (locationFilter === 'not_verified' || locationFilter === 'unverified') {
        if (!hit || hit.locationVerified === true) continue;
      }

      const isPresent = statusKey === 'present';
      rows.push({
        id: hit?.id || null,
        studentId: student.id,
        registrationId: student.registrationNumber,
        studentName: student.fullName,
        fatherName: student.fatherName || '',
        batch: student.batch || '',
        membershipType: student.membershipType || '',
        mobileNumber: student.mobileNumber || '',
        date: dayKeyStr,
        dateDisplay: formatIstDateDisplay(day),
        status: statusLabel,
        statusKey,
        statusLabel,
        checkIn: isPresent ? hit?.checkIn || '' : hit?.checkIn || '',
        checkOut: 0,
        markedAt: hit?.markedAt || null,
        sessionCode: hit?.sessionCode || '',
        method: hit?.method || null,
        source: hit?.source || null,
        sourceLabel: hit ? hit.sourceLabel : '—',
        distanceFromAkhada: hit?.distanceFromAkhada ?? null,
        locationVerified: hit?.locationVerified ?? null,
        gpsAccuracy: hit?.gpsAccuracy ?? null,
        locationLabel:
          !isPresent
            ? '—'
            : hit?.locationVerified === true
              ? 'Verified'
              : hit?.locationVerified === false
                ? 'Not Verified'
                : '—',
        distanceLabel:
          !isPresent || hit?.distanceFromAkhada == null
            ? '—'
            : `${Math.round(hit.distanceFromAkhada)}m`,
      });
    }
  }

  // Newest dates first for UI; Excel export can re-sort ascending
  rows.sort((a, b) => {
    if (a.date === b.date) return a.studentName.localeCompare(b.studentName);
    return a.date < b.date ? 1 : -1;
  });

  const summary = await calculateAttendanceSummary(input, { now });

  return {
    period: summary.period,
    summary: summary.summary,
    students: summary.students,
    rows,
    trainingDates: dates.map(dateKey),
  };
}

/** Paginate matrix rows. */
export function paginateRows(rows, page = 1, limit = 20) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(200, Math.max(1, Number(limit) || 20));
  const total = rows.length;
  const pages = Math.ceil(total / l) || 1;
  const start = (p - 1) * l;
  return {
    rows: rows.slice(start, start + l),
    pagination: { page: p, limit: l, total, pages },
  };
}

/** Day roster: all applicable students for one date. */
export async function getDailyRoster(input = {}, { now = new Date() } = {}) {
  const day = parseDateOnly(input.date || dateKey(todayISTDateOnly(now)));
  const matrix = await buildAttendanceMatrix(
    {
      period: 'custom',
      from: dateKey(day),
      to: dateKey(day),
      search: input.search,
      status: input.status,
    },
    { now }
  );
  const page = paginateRows(matrix.rows, input.page, input.limit);
  const present = matrix.rows.filter((r) => r.statusKey === 'present').length;
  const absent = matrix.rows.filter((r) => r.statusKey === 'absent').length;
  const leave = matrix.rows.filter((r) => r.statusKey === 'leave').length;
  const medicalLeave = matrix.rows.filter((r) => r.statusKey === 'medical_leave').length;
  const competitionLeave = matrix.rows.filter((r) => r.statusKey === 'competition_leave').length;
  const accountable = present + absent;
  return {
    date: dateKey(day),
    summary: {
      totalStudents: matrix.rows.length,
      present,
      absent,
      leave,
      medicalLeave,
      competitionLeave,
      attendancePercentage: pct2(present, accountable),
      attendanceRate: pct2(present, accountable),
    },
    rows: page.rows,
    pagination: page.pagination,
  };
}

/** Student date-wise history for a period (all statuses). */
export async function getStudentAttendanceHistory(studentId, input = {}, { now = new Date() } = {}) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: STUDENT_SELECT,
  });
  if (!student) return null;

  const matrix = await buildAttendanceMatrix(
    {
      ...input,
      search: student.registrationNumber,
    },
    { now }
  );
  const rows = matrix.rows.filter((r) => r.studentId === studentId);
  const statusByDate = new Map(rows.map((r) => [r.date, r.statusKey]));
  const calc = calcStudentRow(student, {
    from: parseDateOnly(matrix.period.from),
    to: parseDateOnly(matrix.period.to),
    trainingDayKeys: await getTrainingDayKeys(),
    statusByDate,
  });

  return {
    student: {
      id: student.id,
      registrationId: student.registrationNumber,
      fullName: student.fullName,
      fatherName: student.fatherName,
      batch: student.batch,
      membershipType: student.membershipType,
    },
    summary: calc,
    history: rows,
    period: matrix.period,
  };
}
