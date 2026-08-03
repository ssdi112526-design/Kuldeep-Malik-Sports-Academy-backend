/**
 * Coach attendance calculation — mirrors student attendanceCalc patterns.
 * Uses CoachAttendance table only (never mixes with student attendance).
 */
import prisma from '../config/db.js';
import {
  attendanceDateFromInstant,
  countTrainingDates,
  dateKey,
  listTrainingDates,
  maxDate,
  parseDateOnly,
  pct2,
  toDateOnly,
  todayISTDateOnly,
} from '../utils/attendanceDate.js';
import {
  getTrainingDayKeys,
  resolvePeriodFilter,
  paginateRows,
} from './attendanceCalc.js';

const COACH_SELECT = {
  id: true,
  fullName: true,
  coachCode: true,
  joiningDate: true,
  createdAt: true,
  status: true,
  fatherName: true,
  mobile: true,
  specialization: true,
  photo: true,
};

function coachSearchWhere(search) {
  const q = String(search || '').trim();
  if (!q) return {};
  const or = [
    { coachCode: { contains: q, mode: 'insensitive' } },
    { fullName: { contains: q, mode: 'insensitive' } },
    { fatherName: { contains: q, mode: 'insensitive' } },
    { mobile: { contains: q, mode: 'insensitive' } },
  ];
  if (/^[0-9a-f-]{36}$/i.test(q)) or.unshift({ id: q });
  return { OR: or };
}

function coachJoinDate(coach) {
  return toDateOnly(coach.joiningDate) || toDateOnly(coach.createdAt);
}

async function resolveCoachCalcWindow(period, { now = new Date() } = {}) {
  const today = todayISTDateOnly(now);
  if (period.period === 'all' || (!period.from && !period.to)) {
    const [earliestJoin, earliestAtt] = await Promise.all([
      prisma.coach.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { joiningDate: true, createdAt: true },
      }),
      prisma.coachAttendance.findFirst({
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);
    const candidates = [
      coachJoinDate(earliestJoin || {}),
      toDateOnly(earliestAtt?.date),
      today,
    ].filter(Boolean);
    const from = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
    return { from, to: today, cappedToToday: true };
  }
  const from = toDateOnly(period.from);
  const rawTo = toDateOnly(period.to);
  const to = rawTo.getTime() > today.getTime() ? today : rawTo;
  return { from, to, cappedToToday: to.getTime() < rawTo.getTime() };
}

export async function loadApplicableCoaches({ from, to, search } = {}) {
  const searchWhere = coachSearchWhere(search);
  const [active, attended] = await Promise.all([
    prisma.coach.findMany({
      where: { status: 'Active', ...searchWhere },
      select: COACH_SELECT,
      orderBy: { fullName: 'asc' },
    }),
    prisma.coachAttendance.findMany({
      where: {
        date: { gte: from, lte: to },
        coach: { ...searchWhere },
      },
      distinct: ['coachId'],
      select: { coach: { select: COACH_SELECT } },
    }),
  ]);

  const map = new Map();
  for (const c of active) {
    const join = coachJoinDate(c);
    if (join && join.getTime() > to.getTime()) continue;
    map.set(c.id, c);
  }
  for (const row of attended) {
    if (row.coach && !map.has(row.coach.id)) map.set(row.coach.id, row.coach);
  }
  return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

async function loadCoachPresentMap({ from, to, coachIds } = {}) {
  const where = { date: { gte: from, lte: to }, status: 'present' };
  if (coachIds?.length) where.coachId = { in: coachIds };
  const rows = await prisma.coachAttendance.groupBy({
    by: ['coachId', 'date'],
    where,
  });
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.coachId)) map.set(r.coachId, new Set());
    map.get(r.coachId).add(dateKey(r.date));
  }
  return map;
}

function calcCoachRow(coach, { from, to, trainingDayKeys, presentDates }) {
  const join = coachJoinDate(coach) || from;
  const coachFrom = maxDate(from, join);
  const trainingDays =
    coachFrom.getTime() <= to.getTime()
      ? countTrainingDates(coachFrom, to, trainingDayKeys)
      : 0;
  let presentDays = 0;
  if (presentDates?.size) {
    for (const key of presentDates) {
      const d = parseDateOnly(key);
      if (d.getTime() >= coachFrom.getTime() && d.getTime() <= to.getTime()) presentDays += 1;
    }
  }
  presentDays = Math.min(presentDays, trainingDays || presentDays);
  const absentDays = Math.max(0, trainingDays - presentDays);
  return {
    coachId: coach.id,
    coachCode: coach.coachCode,
    fullName: coach.fullName,
    fatherName: coach.fatherName || '',
    mobile: coach.mobile || '',
    specialization: coach.specialization || '',
    status: coach.status,
    joiningDate: dateKey(join),
    trainingDays,
    presentDays,
    absentDays,
    attendancePercentage: pct2(presentDays, trainingDays),
    present: presentDays,
    absent: absentDays,
    attendanceRate: pct2(presentDays, trainingDays),
  };
}

export async function calculateCoachAttendanceSummary(input = {}, { now = new Date() } = {}) {
  const period = resolvePeriodFilter(input, now);
  const window = await resolveCoachCalcWindow(period, { now });
  const { from, to } = window;
  const trainingDayKeys = await getTrainingDayKeys();
  const search = input.search || input.coach || '';
  const coaches = await loadApplicableCoaches({ from, to, search });
  const presentMap = await loadCoachPresentMap({
    from,
    to,
    coachIds: coaches.map((c) => c.id),
  });
  const coachRows = coaches.map((c) =>
    calcCoachRow(c, { from, to, trainingDayKeys, presentDates: presentMap.get(c.id) })
  );

  const trainingDaysCalendar = countTrainingDates(from, to, trainingDayKeys);
  const expectedCoachDays = coachRows.reduce((s, r) => s + r.trainingDays, 0);
  const presentCoachDays = coachRows.reduce((s, r) => s + r.presentDays, 0);
  const absentCoachDays = Math.max(0, expectedCoachDays - presentCoachDays);
  const coachIds = coaches.map((c) => c.id);
  const rawWhere = { date: { gte: from, lte: to } };
  if (coachIds.length) rawWhere.coachId = { in: coachIds };
  const rawScanRecords = await prisma.coachAttendance.count({ where: rawWhere });

  return {
    period: { ...period, from: dateKey(from), to: dateKey(to), cappedToToday: window.cappedToToday },
    summary: {
      totalCoaches: coaches.length,
      totalStudents: coaches.length,
      trainingDays: trainingDaysCalendar,
      expectedCoachDays,
      presentCoachDays,
      absentCoachDays,
      presentStudentDays: presentCoachDays,
      absentStudentDays: absentCoachDays,
      attendancePercentage: pct2(presentCoachDays, expectedCoachDays),
      present: presentCoachDays,
      absent: absentCoachDays,
      attendanceRate: pct2(presentCoachDays, expectedCoachDays),
      rawScanRecords,
      uniqueAttendanceDays: presentCoachDays,
      totalRecords: rawScanRecords,
    },
    coaches: coachRows,
    students: coachRows,
  };
}

export async function calculateTodayCoachStats({ date, now = new Date() } = {}) {
  let day;
  if (date instanceof Date && !Number.isNaN(date.getTime())) day = toDateOnly(date);
  else if (date) day = parseDateOnly(date);
  else day = attendanceDateFromInstant(now);

  const totalCoaches = await prisma.coach.count({ where: { status: 'Active' } });
  const presentRows = await prisma.coachAttendance.groupBy({
    by: ['coachId'],
    where: { date: day, status: 'present', coach: { status: 'Active' } },
  });
  const present = presentRows.length;
  const absent = Math.max(0, totalCoaches - present);
  return {
    date: dateKey(day),
    totalCoaches,
    totalStudents: totalCoaches,
    present,
    absent,
    attendanceRate: pct2(present, totalCoaches),
    attendancePercentage: pct2(present, totalCoaches),
  };
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

async function loadCoachCheckInMap({ from, to, coachIds } = {}) {
  const where = { date: { gte: from, lte: to }, status: 'present' };
  if (coachIds?.length) where.coachId = { in: coachIds };
  const rows = await prisma.coachAttendance.findMany({
    where,
    select: {
      coachId: true,
      date: true,
      markedAt: true,
      session: { select: { sessionCode: true } },
    },
    orderBy: { markedAt: 'asc' },
  });
  const map = new Map();
  for (const r of rows) {
    const key = `${r.coachId}|${dateKey(r.date)}`;
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

export async function buildCoachAttendanceMatrix(input = {}, { now = new Date() } = {}) {
  const period = resolvePeriodFilter(input, now);
  const window = await resolveCoachCalcWindow(period, { now });
  const { from, to } = window;
  const trainingDayKeys = await getTrainingDayKeys();
  const search = input.search || input.coach || '';
  const statusFilter = String(input.status || 'all').toLowerCase();
  const coaches = await loadApplicableCoaches({ from, to, search });
  const dates = listTrainingDates(from, to, trainingDayKeys);
  const checkInMap = await loadCoachCheckInMap({
    from,
    to,
    coachIds: coaches.map((c) => c.id),
  });

  const rows = [];
  for (const day of dates) {
    const dayKeyStr = dateKey(day);
    for (const coach of coaches) {
      const join = coachJoinDate(coach) || from;
      if (join.getTime() > day.getTime()) continue;
      const hit = checkInMap.get(`${coach.id}|${dayKeyStr}`);
      const status = hit ? 'Present' : 'Absent';
      if (statusFilter === 'present' && status !== 'Present') continue;
      if (statusFilter === 'absent' && status !== 'Absent') continue;
      rows.push({
        coachId: coach.id,
        studentId: coach.id,
        coachCode: coach.coachCode,
        registrationId: coach.coachCode,
        studentName: coach.fullName,
        coachName: coach.fullName,
        fatherName: coach.fatherName || '',
        batch: coach.specialization || '',
        membershipType: '',
        mobileNumber: coach.mobile || '',
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

  rows.sort((a, b) => {
    if (a.date === b.date) return a.studentName.localeCompare(b.studentName);
    return a.date < b.date ? 1 : -1;
  });

  const summary = await calculateCoachAttendanceSummary(input, { now });
  return {
    period: summary.period,
    summary: summary.summary,
    coaches: summary.coaches,
    students: summary.coaches,
    rows,
    trainingDates: dates.map(dateKey),
  };
}

export { paginateRows };

export async function getCoachAttendanceHistory(coachId, input = {}, { now = new Date() } = {}) {
  const coach = await prisma.coach.findUnique({ where: { id: coachId }, select: COACH_SELECT });
  if (!coach) return null;
  const matrix = await buildCoachAttendanceMatrix(
    { ...input, search: coach.coachCode },
    { now }
  );
  const rows = matrix.rows.filter((r) => r.coachId === coachId);
  const calc = calcCoachRow(coach, {
    from: parseDateOnly(matrix.period.from),
    to: parseDateOnly(matrix.period.to),
    trainingDayKeys: await getTrainingDayKeys(),
    presentDates: new Set(rows.filter((r) => r.status === 'Present').map((r) => r.date)),
  });
  return {
    coach: {
      id: coach.id,
      coachCode: coach.coachCode,
      registrationId: coach.coachCode,
      fullName: coach.fullName,
      fatherName: coach.fatherName,
      specialization: coach.specialization,
    },
    student: {
      id: coach.id,
      registrationId: coach.coachCode,
      fullName: coach.fullName,
      fatherName: coach.fatherName,
    },
    summary: calc,
    history: rows,
    period: matrix.period,
  };
}
