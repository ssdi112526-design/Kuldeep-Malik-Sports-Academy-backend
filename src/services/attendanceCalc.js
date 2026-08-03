import prisma from '../config/db.js';
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
  const where = {
    date: { gte: from, lte: to },
    status: 'present',
  };
  if (studentIds?.length) where.studentId = { in: studentIds };

  const rows = await prisma.attendance.groupBy({
    by: ['studentId', 'date'],
    where,
  });

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.studentId)) map.set(r.studentId, new Set());
    map.get(r.studentId).add(dateKey(r.date));
  }
  return map;
}

export function calcStudentRow(student, { from, to, trainingDayKeys, presentDates }) {
  const join = toDateOnly(student.joiningDate) || from;
  const studentFrom = maxDate(from, join);
  const studentTo = to;
  const trainingDays =
    studentFrom.getTime() <= studentTo.getTime()
      ? countTrainingDates(studentFrom, studentTo, trainingDayKeys)
      : 0;

  let presentDays = 0;
  if (presentDates?.size) {
    for (const key of presentDates) {
      const d = parseDateOnly(key);
      if (d.getTime() >= studentFrom.getTime() && d.getTime() <= studentTo.getTime()) {
        presentDays += 1;
      }
    }
  }
  // Never allow present > training days (duplicate/edge protection)
  presentDays = Math.min(presentDays, trainingDays || presentDays);
  const absentDays = Math.max(0, trainingDays - presentDays);
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
    attendancePercentage: pct2(presentDays, trainingDays),
    // aliases used by existing UI/export
    present: presentDays,
    absent: absentDays,
    attendanceRate: pct2(presentDays, trainingDays),
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
  const presentMap = await loadPresentDateMap({
    from,
    to,
    studentIds: students.map((s) => s.id),
  });

  const studentRows = students.map((s) =>
    calcStudentRow(s, {
      from,
      to,
      trainingDayKeys,
      presentDates: presentMap.get(s.id),
    })
  );

  const trainingDaysCalendar = countTrainingDates(from, to, trainingDayKeys);
  const expectedStudentDays = studentRows.reduce((sum, r) => sum + r.trainingDays, 0);
  const presentStudentDays = studentRows.reduce((sum, r) => sum + r.presentDays, 0);
  const absentStudentDays = Math.max(0, expectedStudentDays - presentStudentDays);

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
      attendancePercentage: pct2(presentStudentDays, expectedStudentDays),
      // UI-friendly aliases
      present: presentStudentDays,
      absent: absentStudentDays,
      attendanceRate: pct2(presentStudentDays, expectedStudentDays),
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
  const presentMap = await loadPresentDateMap({
    from: window.from,
    to: window.to,
    studentIds: [studentId],
  });

  return calcStudentRow(student, {
    from: window.from,
    to: window.to,
    trainingDayKeys,
    presentDates: presentMap.get(studentId),
  });
}

/** Today's dashboard stats — unique active students present today. */
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

  const presentRows = await prisma.attendance.groupBy({
    by: ['studentId'],
    where: {
      date: day,
      status: 'present',
      student: { status: 'Active' },
    },
  });
  const present = presentRows.length;
  const absent = Math.max(0, totalStudents - present);

  return {
    date: dateKey(day),
    totalStudents,
    present,
    absent,
    attendanceRate: pct2(present, totalStudents),
    attendancePercentage: pct2(present, totalStudents),
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

/** Earliest check-in (markedAt) per studentId+date. */
async function loadCheckInMap({ from, to, studentIds } = {}) {
  const where = {
    date: { gte: from, lte: to },
    status: 'present',
  };
  if (studentIds?.length) where.studentId = { in: studentIds };

  const rows = await prisma.attendance.findMany({
    where,
    select: { studentId: true, date: true, markedAt: true, session: { select: { sessionCode: true } } },
    orderBy: { markedAt: 'asc' },
  });

  const map = new Map();
  for (const r of rows) {
    const key = `${r.studentId}|${dateKey(r.date)}`;
    if (!map.has(key)) {
      map.set(key, {
        markedAt: r.markedAt,
        checkIn: formatIstTime(r.markedAt),
        sessionCode: r.session?.sessionCode || '',
      });
    }
  }
  return map;
}

/**
 * Full attendance matrix: every applicable training date × every applicable student.
 * Missing DB row ⇒ Absent. Duplicate same-day present ⇒ counted once.
 */
export async function buildAttendanceMatrix(input = {}, { now = new Date() } = {}) {
  const period = resolvePeriodFilter(input, now);
  const window = await resolveCalcWindow(period, { now });
  const { from, to } = window;
  const trainingDayKeys = await getTrainingDayKeys();
  const search = input.search || input.student || '';
  const statusFilter = String(input.status || 'all').toLowerCase();

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
      const status = hit ? 'Present' : 'Absent';
      if (statusFilter === 'present' && status !== 'Present') continue;
      if (statusFilter === 'absent' && status !== 'Absent') continue;

      rows.push({
        studentId: student.id,
        registrationId: student.registrationNumber,
        studentName: student.fullName,
        fatherName: student.fatherName || '',
        batch: student.batch || '',
        membershipType: student.membershipType || '',
        mobileNumber: student.mobileNumber || '',
        date: dayKeyStr,
        dateDisplay: formatIstDateDisplay(day),
        status,
        checkIn: hit?.checkIn || 0,
        checkOut: 0,
        markedAt: hit?.markedAt || null,
        sessionCode: hit?.sessionCode || '',
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
  const present = matrix.rows.filter((r) => r.status === 'Present').length;
  const absent = matrix.rows.filter((r) => r.status === 'Absent').length;
  return {
    date: dateKey(day),
    summary: {
      totalStudents: present + absent,
      present,
      absent,
      attendancePercentage: pct2(present, present + absent),
      attendanceRate: pct2(present, present + absent),
    },
    rows: page.rows,
    pagination: page.pagination,
  };
}

/** Student date-wise history (Present + Absent) for a period. */
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
  const calc = calcStudentRow(student, {
    from: parseDateOnly(matrix.period.from),
    to: parseDateOnly(matrix.period.to),
    trainingDayKeys: await getTrainingDayKeys(),
    presentDates: new Set(rows.filter((r) => r.status === 'Present').map((r) => r.date)),
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
