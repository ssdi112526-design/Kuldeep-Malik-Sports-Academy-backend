import prisma from '../config/db.js';
import {
  isKheloIndia,
  kheloWhere,
  resolveAgeCategory,
  resolveWeightCategory,
  resolvePlayerCategory,
  formatDateIN,
  ageFromDobOrField,
} from '../utils/reportPlayerHelpers.js';
import {
  calculateAttendanceSummary,
  paginateRows,
} from './attendanceCalc.js';
import { calculateCoachAttendanceSummary } from './coachAttendanceCalc.js';
import { listPendingFees, listCoachPayments, serializeMoney } from './financeService.js';
import { countActiveSponsorships, listSponsorships } from './sponsorshipService.js';
import { feeCategoryLabel } from '../constants/feeCategories.js';
import { monthLabel } from '../utils/financeMoney.js';

function paginate(page = 1, limit = 20) {
  const take = Math.min(200, Math.max(1, Number(limit) || 20));
  const p = Math.max(1, Number(page) || 1);
  return { take, skip: (p - 1) * take, page: p };
}

function studentSearchWhere(search) {
  const q = String(search || '').trim();
  if (!q) return {};
  return {
    OR: [
      { fullName: { contains: q, mode: 'insensitive' } },
      { registrationNumber: { contains: q, mode: 'insensitive' } },
      { mobileNumber: { contains: q, mode: 'insensitive' } },
      { category: { contains: q, mode: 'insensitive' } },
      { membershipType: { contains: q, mode: 'insensitive' } },
    ],
  };
}

function enrichStudent(s) {
  return {
    ...s,
    id: s.id,
    _id: s.id,
    isKheloIndia: isKheloIndia(s),
    resolvedAgeCategory: resolveAgeCategory(s),
    resolvedWeightCategory: resolveWeightCategory(s),
    resolvedPlayerCategory: resolvePlayerCategory(s),
    ageComputed: ageFromDobOrField(s),
    joiningDateLabel: formatDateIN(s.joiningDate),
    dateOfBirthLabel: formatDateIN(s.dateOfBirth),
  };
}

export async function getReportsDashboard() {
  const [
    totalPlayers,
    activePlayers,
    inactivePlayers,
    kheloPlayers,
    totalEmployees,
    totalTournaments,
    achievementMedals,
    resultMedals,
    pendingAgg,
    activeSponsorships,
    studentsForCharts,
    feePaidAgg,
    salaryAgg,
  ] = await Promise.all([
    prisma.student.count(),
    prisma.student.count({ where: { status: 'Active' } }),
    prisma.student.count({ where: { status: { in: ['Inactive', 'Suspended'] } } }),
    prisma.student.count({ where: kheloWhere() }),
    prisma.coach.count(),
    prisma.tournament.count(),
    prisma.playerAchievement.groupBy({
      by: ['medal'],
      _count: { _all: true },
      where: { medal: { not: null } },
    }),
    prisma.tournamentResult.groupBy({
      by: ['medal'],
      _count: { _all: true },
      where: { medal: { not: null } },
    }),
    prisma.studentFeeMonth.aggregate({
      where: {
        deletedAt: null,
        status: { in: ['Due', 'Partial', 'Overdue'] },
        remainingDue: { gt: 0 },
      },
      _sum: { remainingDue: true },
      _count: { _all: true },
    }),
    countActiveSponsorships(),
    prisma.student.findMany({
      select: {
        category: true,
        membershipType: true,
        ageCategory: true,
        weightCategory: true,
        weightKg: true,
        age: true,
        dateOfBirth: true,
      },
    }),
    prisma.studentFeePayment.aggregate({
      where: { deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.coachPayment.aggregate({
      where: { deletedAt: null },
      _sum: { paidAmount: true, remainingAmount: true },
    }),
  ]);

  const medalMap = { Gold: 0, Silver: 0, Bronze: 0, Other: 0 };
  for (const g of [...achievementMedals, ...resultMedals]) {
    const key = String(g.medal || 'Other');
    const norm = /gold/i.test(key)
      ? 'Gold'
      : /silver/i.test(key)
        ? 'Silver'
        : /bronze/i.test(key)
          ? 'Bronze'
          : 'Other';
    medalMap[norm] = (medalMap[norm] || 0) + g._count._all;
  }
  const totalMedals = medalMap.Gold + medalMap.Silver + medalMap.Bronze + medalMap.Other;

  const playerCatCounts = {};
  const weightCounts = {};
  let otherCategoryPlayers = 0;
  for (const s of studentsForCharts) {
    if (!isKheloIndia(s)) otherCategoryPlayers += 1;
    const pc = resolvePlayerCategory(s);
    playerCatCounts[pc] = (playerCatCounts[pc] || 0) + 1;
    const wc = resolveWeightCategory(s);
    weightCounts[wc] = (weightCounts[wc] || 0) + 1;
  }

  const attendance = await calculateAttendanceSummary({ period: 'month' });

  const pendingFees = Number(pendingAgg._sum.remainingDue || 0);
  const paidFees = Number(feePaidAgg._sum.amount || 0);
  const paidSalary = Number(salaryAgg._sum.paidAmount || 0);
  const pendingSalary = Number(salaryAgg._sum.remainingAmount || 0);

  return {
    cards: {
      totalPlayers,
      activePlayers,
      inactivePlayers,
      kheloIndiaPlayers: kheloPlayers,
      otherPlayerCategories: otherCategoryPlayers,
      totalEmployees,
      totalTournaments,
      totalMedals,
      pendingFees,
      pendingFeesCount: pendingAgg._count._all,
      activeSponsorships,
    },
    medals: medalMap,
    charts: {
      playersByCategory: Object.entries(playerCatCounts).map(([label, value]) => ({ label, value })),
      playersByWeight: Object.entries(weightCounts).map(([label, value]) => ({ label, value })),
      attendanceBreakdown: [
        { label: 'Present', value: attendance.summary?.presentStudentDays || 0, color: 'green' },
        { label: 'Absent', value: attendance.summary?.absentStudentDays || 0, color: 'red' },
        { label: 'Leave', value: attendance.summary?.leaveStudentDays || 0, color: 'amber' },
        {
          label: 'Medical Leave',
          value: attendance.summary?.medicalLeaveStudentDays || 0,
          color: 'purple',
        },
        {
          label: 'Competition Leave',
          value: attendance.summary?.competitionLeaveStudentDays || 0,
          color: 'orange',
        },
      ],
      medalDistribution: [
        { label: 'Gold', value: medalMap.Gold, color: 'gold' },
        { label: 'Silver', value: medalMap.Silver, color: 'silver' },
        { label: 'Bronze', value: medalMap.Bronze, color: 'bronze' },
      ],
      feesPaidVsPending: [
        { label: 'Paid', value: paidFees },
        { label: 'Pending', value: pendingFees },
      ],
      salaryPaidVsPending: [
        { label: 'Paid', value: paidSalary },
        { label: 'Pending', value: pendingSalary },
      ],
    },
    attendanceThisMonth: {
      percentage: attendance.summary?.attendancePercentage ?? 0,
      present: attendance.summary?.presentStudentDays ?? 0,
      absent: attendance.summary?.absentStudentDays ?? 0,
    },
  };
}

export async function reportPlayers(query = {}) {
  const { take, skip, page } = paginate(query.page, query.limit);
  const where = { ...studentSearchWhere(query.search) };
  if (query.status) where.status = String(query.status);
  if (query.category) {
    where.category = { equals: String(query.category), mode: 'insensitive' };
  }
  if (query.khelo === '1' || query.khelo === 'true') {
    Object.assign(where, kheloWhere());
  } else if (query.khelo === '0' || query.khelo === 'false') {
    where.NOT = kheloWhere();
  }
  if (query.from || query.to) {
    where.joiningDate = {};
    if (query.from) where.joiningDate.gte = new Date(query.from);
    if (query.to) where.joiningDate.lte = new Date(query.to);
  }

  const [total, rows, active, inactive, khelo, recent] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      skip,
      take,
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        registrationNumber: true,
        fullName: true,
        gender: true,
        dateOfBirth: true,
        age: true,
        mobileNumber: true,
        category: true,
        membershipType: true,
        ageCategory: true,
        weightCategory: true,
        weightKg: true,
        status: true,
        joiningDate: true,
        batch: true,
        trainingLevel: true,
      },
    }),
    prisma.student.count({ where: { ...where, status: 'Active' } }),
    prisma.student.count({
      where: { ...where, status: { in: ['Inactive', 'Suspended'] } },
    }),
    prisma.student.count({ where: { AND: [where, kheloWhere()] } }),
    prisma.student.count({
      where: {
        ...where,
        joiningDate: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  let enriched = rows.map(enrichStudent);
  if (query.ageCategory) {
    enriched = enriched.filter(
      (r) => r.resolvedAgeCategory.toLowerCase() === String(query.ageCategory).toLowerCase()
    );
  }
  if (query.weightCategory) {
    enriched = enriched.filter(
      (r) =>
        r.resolvedWeightCategory.toLowerCase() === String(query.weightCategory).toLowerCase()
    );
  }

  return {
    summary: {
      total,
      active,
      inactive,
      kheloIndia: khelo,
      newPlayers: recent,
    },
    total,
    page,
    limit: take,
    rows: enriched,
  };
}

export async function reportKheloIndia(query = {}) {
  return reportPlayers({ ...query, khelo: '1' });
}

export async function reportAttendanceDashboard(query = {}) {
  const summary = await calculateAttendanceSummary({
    period: query.period || (query.month && query.year ? 'select' : 'month'),
    month: query.month,
    year: query.year,
    from: query.from,
    to: query.to,
    search: query.search,
  });
  return {
    totalPlayers: summary.summary?.totalStudents ?? 0,
    present: summary.summary?.presentStudentDays ?? 0,
    absent: summary.summary?.absentStudentDays ?? 0,
    leave: summary.summary?.leaveStudentDays ?? 0,
    medicalLeave: summary.summary?.medicalLeaveStudentDays ?? 0,
    competitionLeave: summary.summary?.competitionLeaveStudentDays ?? 0,
    attendancePercentage: summary.summary?.attendancePercentage ?? 0,
    period: summary.period,
    summary: summary.summary,
  };
}

export async function reportMonthlyAttendance(query = {}) {
  const calc = await calculateAttendanceSummary({
    period: 'select',
    month: query.month,
    year: query.year,
    search: query.search || query.player,
    studentId: query.studentId,
  });
  let rows = calc.students || [];
  if (query.category) {
    const cat = String(query.category).toLowerCase();
    const students = await prisma.student.findMany({
      where: { id: { in: rows.map((r) => r.studentId) } },
      select: { id: true, category: true, membershipType: true },
    });
    const map = new Map(students.map((s) => [s.id, s]));
    rows = rows.filter((r) => {
      const s = map.get(r.studentId);
      if (!s) return false;
      return (
        String(s.category || '').toLowerCase().includes(cat) ||
        String(s.membershipType || '').toLowerCase().includes(cat)
      );
    });
  }
  if (query.studentId) {
    rows = rows.filter((r) => r.studentId === query.studentId);
  }
  const { page, limit } = query;
  const paged = paginateRows(rows, page, limit);
  return {
    period: calc.period,
    summary: calc.summary,
    total: paged.total,
    page: paged.page,
    limit: paged.limit,
    rows: paged.rows.map((r) => ({
      ...r,
      id: r.studentId,
      _id: r.studentId,
      player: r.fullName,
      present: r.presentDays,
      absent: r.absentDays,
      leave: r.leaveDays,
      medicalLeave: r.medicalLeaveDays,
      competitionLeave: r.competitionLeaveDays,
      attendancePct: r.attendancePercentage,
    })),
  };
}

export async function reportEmployeeAttendance(query = {}) {
  const calc = await calculateCoachAttendanceSummary({
    period: 'select',
    month: query.month,
    year: query.year,
    search: query.search || query.employee,
  });
  let rows = calc.coaches || [];

  if (query.role) {
    rows = rows.filter((r) =>
      String(r.employeeRole || r.role || '')
        .toLowerCase()
        .includes(String(query.role).toLowerCase())
    );
  }
  if (query.category) {
    rows = rows.filter((r) =>
      String(r.category || '')
        .toLowerCase()
        .includes(String(query.category).toLowerCase())
    );
  }
  if (query.coachId || query.employeeId) {
    const id = query.coachId || query.employeeId;
    rows = rows.filter((r) => r.coachId === id || r.id === id);
  }

  const coachIds = rows.map((r) => r.coachId || r.id).filter(Boolean);
  const coaches = await prisma.coach.findMany({
    where: { id: { in: coachIds } },
    select: {
      id: true,
      fullName: true,
      employeeRole: true,
      category: true,
      joiningDate: true,
      designation: true,
    },
  });
  const cmap = new Map(coaches.map((c) => [c.id, c]));

  let enriched = rows.map((r) => {
    const id = r.coachId || r.id;
    const c = cmap.get(id) || {};
    return {
      ...r,
      id,
      _id: id,
      employeeName: r.fullName || c.fullName,
      role: c.employeeRole || r.employeeRole || c.designation || '',
      category: c.category || r.category || '',
      joiningDate: formatDateIN(c.joiningDate || r.joiningDate),
      present: r.presentDays ?? r.present ?? 0,
      absent: r.absentDays ?? r.absent ?? 0,
      leave: r.leaveDays ?? r.leave ?? 0,
      attendancePct: r.attendancePercentage ?? r.attendanceRate ?? 0,
    };
  });

  if (query.role) {
    const role = String(query.role).toLowerCase();
    enriched = enriched.filter((r) => String(r.role).toLowerCase().includes(role));
  }
  if (query.category) {
    const cat = String(query.category).toLowerCase();
    enriched = enriched.filter((r) => String(r.category).toLowerCase().includes(cat));
  }

  const paged = paginateRows(enriched, query.page, query.limit);
  return {
    period: calc.period,
    summary: calc.summary,
    total: paged.total,
    page: paged.page,
    limit: paged.limit,
    rows: paged.rows,
  };
}

function groupStudentsByResolver(students, resolver) {
  const groups = new Map();
  for (const s of students) {
    const key = resolver(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(enrichStudent(s));
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, players]) => ({
      category,
      totalPlayers: players.length,
      players,
    }));
}

export async function reportAgeCategories(query = {}) {
  const where = { ...studentSearchWhere(query.search) };
  if (query.status) where.status = String(query.status);
  const students = await prisma.student.findMany({
    where,
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      registrationNumber: true,
      fullName: true,
      gender: true,
      status: true,
      age: true,
      dateOfBirth: true,
      ageCategory: true,
      weightCategory: true,
      weightKg: true,
      category: true,
      membershipType: true,
      joiningDate: true,
    },
  });
  let groups = groupStudentsByResolver(students, resolveAgeCategory);
  if (query.ageCategory) {
    groups = groups.filter(
      (g) => g.category.toLowerCase() === String(query.ageCategory).toLowerCase()
    );
  }
  return { totalGroups: groups.length, totalPlayers: students.length, groups };
}

export async function reportPlayerCategories(query = {}) {
  const where = { ...studentSearchWhere(query.search) };
  if (query.status) where.status = String(query.status);
  const students = await prisma.student.findMany({
    where,
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      registrationNumber: true,
      fullName: true,
      gender: true,
      status: true,
      category: true,
      membershipType: true,
      ageCategory: true,
      weightCategory: true,
      joiningDate: true,
    },
  });
  let groups = groupStudentsByResolver(students, resolvePlayerCategory);
  if (query.category) {
    groups = groups.filter(
      (g) => g.category.toLowerCase() === String(query.category).toLowerCase()
    );
  }
  return { totalGroups: groups.length, totalPlayers: students.length, groups };
}

export async function reportWeightCategories(query = {}) {
  const where = { ...studentSearchWhere(query.search) };
  if (query.status) where.status = String(query.status);
  const students = await prisma.student.findMany({
    where,
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      registrationNumber: true,
      fullName: true,
      gender: true,
      status: true,
      weightKg: true,
      weightCategory: true,
      ageCategory: true,
      age: true,
      dateOfBirth: true,
      category: true,
      membershipType: true,
      joiningDate: true,
    },
  });
  let groups = groupStudentsByResolver(students, resolveWeightCategory);
  if (query.weightCategory) {
    groups = groups.filter(
      (g) => g.category.toLowerCase() === String(query.weightCategory).toLowerCase()
    );
  }
  return {
    totalGroups: groups.length,
    totalPlayers: students.length,
    groups: groups.map((g) => ({
      ...g,
      players: g.players.map((p) => ({
        ...p,
        ageCategoryLabel: p.resolvedAgeCategory,
        status: p.status,
      })),
    })),
  };
}

export async function reportTournaments(query = {}) {
  const { take, skip, page } = paginate(query.page, query.limit);
  const where = {};
  if (query.tournamentId) where.tournamentId = String(query.tournamentId);
  if (query.studentId) where.studentId = String(query.studentId);
  if (query.medal) where.medal = { contains: String(query.medal), mode: 'insensitive' };
  if (query.search?.trim()) {
    const q = query.search.trim();
    where.OR = [
      { result: { contains: q, mode: 'insensitive' } },
      { category: { contains: q, mode: 'insensitive' } },
      { remarks: { contains: q, mode: 'insensitive' } },
      { student: { fullName: { contains: q, mode: 'insensitive' } } },
      { tournament: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }
  if (query.year) {
    const y = Number(query.year);
    where.tournament = {
      ...(where.tournament || {}),
      eventDate: {
        gte: new Date(`${y}-01-01`),
        lte: new Date(`${y}-12-31T23:59:59`),
      },
    };
  }
  if (query.from || query.to) {
    where.tournament = {
      ...(where.tournament || {}),
      eventDate: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    };
  }

  const [total, rows] = await Promise.all([
    prisma.tournamentResult.count({ where }),
    prisma.tournamentResult.findMany({
      where,
      skip,
      take,
      orderBy: { tournament: { eventDate: 'desc' } },
      include: {
        student: {
          select: {
            id: true,
            fullName: true,
            registrationNumber: true,
            category: true,
            weightCategory: true,
            weightKg: true,
          },
        },
        tournament: true,
      },
    }),
  ]);

  return {
    total,
    page,
    limit: take,
    rows: rows.map((r) => ({
      id: r.id,
      _id: r.id,
      tournamentName: r.tournament?.name,
      date: formatDateIN(r.tournament?.eventDate),
      eventDate: r.tournament?.eventDate,
      location: r.tournament?.location || '',
      player: r.student?.fullName,
      registrationNumber: r.student?.registrationNumber,
      studentId: r.studentId,
      category: r.category || r.student?.category || '',
      weightCategory:
        r.student?.weightCategory ||
        resolveWeightCategory(r.student || {}) ||
        '',
      result: r.result || '',
      position: r.position || '',
      medal: r.medal || '',
      remarks: r.remarks || '',
    })),
  };
}

export async function reportMedals(query = {}) {
  const medalFilter = query.medal
    ? { contains: String(query.medal), mode: 'insensitive' }
    : { not: null };

  const [achievements, results] = await Promise.all([
    prisma.playerAchievement.findMany({
      where: {
        medal: medalFilter,
        ...(query.studentId ? { studentId: String(query.studentId) } : {}),
        ...(query.year ? { year: Number(query.year) } : {}),
        ...(query.search?.trim()
          ? {
              OR: [
                { title: { contains: query.search.trim(), mode: 'insensitive' } },
                { tournamentName: { contains: query.search.trim(), mode: 'insensitive' } },
                { student: { fullName: { contains: query.search.trim(), mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        student: { select: { fullName: true, registrationNumber: true, category: true } },
        tournament: { select: { name: true, eventDate: true } },
      },
      orderBy: [{ achievedOn: 'desc' }, { year: 'desc' }],
    }),
    prisma.tournamentResult.findMany({
      where: {
        medal: medalFilter,
        ...(query.studentId ? { studentId: String(query.studentId) } : {}),
        ...(query.search?.trim()
          ? {
              OR: [
                { student: { fullName: { contains: query.search.trim(), mode: 'insensitive' } } },
                { tournament: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
              ],
            }
          : {}),
        ...(query.year
          ? {
              tournament: {
                eventDate: {
                  gte: new Date(`${Number(query.year)}-01-01`),
                  lte: new Date(`${Number(query.year)}-12-31T23:59:59`),
                },
              },
            }
          : {}),
      },
      include: {
        student: { select: { fullName: true, registrationNumber: true, category: true } },
        tournament: { select: { name: true, eventDate: true } },
      },
      orderBy: { tournament: { eventDate: 'desc' } },
    }),
  ]);

  const normalizeMedal = (m) => {
    const key = String(m || '');
    if (/gold/i.test(key)) return 'Gold';
    if (/silver/i.test(key)) return 'Silver';
    if (/bronze/i.test(key)) return 'Bronze';
    return key || 'Other';
  };

  const rows = [
    ...achievements.map((a) => ({
      id: `ach-${a.id}`,
      source: 'achievement',
      player: a.student?.fullName,
      registrationNumber: a.student?.registrationNumber,
      tournament: a.tournament?.name || a.tournamentName || '',
      medal: normalizeMedal(a.medal),
      medalRaw: a.medal,
      category: a.student?.category || a.achievementType || '',
      date: formatDateIN(a.achievedOn || a.tournament?.eventDate),
      year: a.year,
    })),
    ...results.map((r) => ({
      id: `res-${r.id}`,
      source: 'tournament',
      player: r.student?.fullName,
      registrationNumber: r.student?.registrationNumber,
      tournament: r.tournament?.name || '',
      medal: normalizeMedal(r.medal),
      medalRaw: r.medal,
      category: r.category || r.student?.category || '',
      date: formatDateIN(r.tournament?.eventDate),
      year: r.tournament?.eventDate ? new Date(r.tournament.eventDate).getFullYear() : null,
    })),
  ];

  const counts = { Gold: 0, Silver: 0, Bronze: 0, Other: 0, Total: 0 };
  for (const r of rows) {
    if (counts[r.medal] != null) counts[r.medal] += 1;
    else counts.Other += 1;
    counts.Total += 1;
  }

  const { take, skip, page } = paginate(query.page, query.limit);
  return {
    counts,
    total: rows.length,
    page,
    limit: take,
    rows: rows.slice(skip, skip + take),
  };
}

export async function reportPendingFees(query = {}) {
  const data = await listPendingFees({
    search: query.search,
    page: query.page,
    limit: query.limit,
  });
  let rows = data.rows || [];
  if (query.month) rows = rows.filter((r) => Number(r.month) === Number(query.month));
  if (query.year) rows = rows.filter((r) => Number(r.year) === Number(query.year));
  if (query.feeCategory || query.category) {
    const c = String(query.feeCategory || query.category);
    rows = rows.filter((r) => String(r.category) === c);
  }
  if (query.status) {
    rows = rows.filter((r) => String(r.status).toLowerCase() === String(query.status).toLowerCase());
  }
  if (query.studentId) {
    rows = rows.filter((r) => r.studentId === query.studentId || r.student?.id === query.studentId);
  }
  return {
    ...data,
    total: rows.length,
    rows: rows.map((r) => ({
      ...r,
      feeType: r.categoryLabel || feeCategoryLabel(r.category),
      totalFee: r.feeAmount,
      pendingAmount: r.remainingDue,
      dueDateLabel: formatDateIN(r.dueDate),
    })),
  };
}

export async function reportEmployeeSalary(query = {}) {
  const data = await listCoachPayments({
    search: query.search,
    status: query.status,
    month: query.month,
    year: query.year,
    page: query.page,
    limit: query.limit,
  });
  const rows = (data.rows || data.payments || []).map((r) => ({
    ...r,
    employeeName: r.coach?.fullName || r.coachName || '',
    role: r.coach?.employeeRole || r.coach?.designation || '',
    category: r.coach?.category || '',
    salary: r.baseSalary ?? r.netPayable,
    paymentDateLabel: formatDateIN(r.paymentDate),
    paidAmount: r.paidAmount,
    pendingAmount: r.remainingAmount,
    paymentStatus: r.status,
    monthLabel: r.monthLabel || monthLabel(r.month, r.year),
  }));

  const summary = {
    totalSalary: rows.reduce((s, r) => s + Number(r.netPayable || r.salary || 0), 0),
    paidSalary: rows.reduce((s, r) => s + Number(r.paidAmount || 0), 0),
    pendingSalary: rows.reduce((s, r) => s + Number(r.pendingAmount || 0), 0),
  };

  return {
    ...data,
    summary: serializeMoney(summary),
    rows,
  };
}

export async function reportSponsorshipDocuments(query = {}) {
  return listSponsorships(query);
}

/** Export row builders keyed by reportKey */
export async function buildExportPayload(reportKey, query = {}) {
  const key = String(reportKey || '');
  switch (key) {
    case 'players':
    case 'khelo-india': {
      const data =
        key === 'khelo-india'
          ? await reportKheloIndia({ ...query, page: 1, limit: 5000 })
          : await reportPlayers({ ...query, page: 1, limit: 5000 });
      return {
        sheetName: key === 'khelo-india' ? 'Khelo India' : 'Players',
        columns: [
          { key: 'registrationNumber', label: 'Reg No' },
          { key: 'fullName', label: 'Player' },
          { key: 'resolvedPlayerCategory', label: 'Category' },
          { key: 'resolvedAgeCategory', label: 'Age Category' },
          { key: 'resolvedWeightCategory', label: 'Weight Category' },
          { key: 'gender', label: 'Gender' },
          { key: 'ageComputed', label: 'Age' },
          { key: 'mobileNumber', label: 'Mobile' },
          { key: 'joiningDateLabel', label: 'Joining' },
          { key: 'status', label: 'Status' },
        ],
        rows: data.rows,
      };
    }
    case 'monthly-attendance': {
      const data = await reportMonthlyAttendance({ ...query, page: 1, limit: 5000 });
      return {
        sheetName: 'Monthly Attendance',
        columns: [
          { key: 'fullName', label: 'Player' },
          { key: 'registrationId', label: 'Reg No' },
          { key: 'present', label: 'Present' },
          { key: 'absent', label: 'Absent' },
          { key: 'leave', label: 'Leave' },
          { key: 'medicalLeave', label: 'Medical Leave' },
          { key: 'competitionLeave', label: 'Competition Leave' },
          { key: 'attendancePct', label: 'Attendance %' },
        ],
        rows: data.rows,
      };
    }
    case 'employee-attendance': {
      const data = await reportEmployeeAttendance({ ...query, page: 1, limit: 5000 });
      return {
        sheetName: 'Employee Attendance',
        columns: [
          { key: 'employeeName', label: 'Employee' },
          { key: 'role', label: 'Role' },
          { key: 'category', label: 'Category' },
          { key: 'joiningDate', label: 'Joining' },
          { key: 'present', label: 'Present' },
          { key: 'absent', label: 'Absent' },
          { key: 'leave', label: 'Leave' },
          { key: 'attendancePct', label: 'Attendance %' },
        ],
        rows: data.rows,
      };
    }
    case 'tournaments': {
      const data = await reportTournaments({ ...query, page: 1, limit: 5000 });
      return {
        sheetName: 'Tournament Records',
        columns: [
          { key: 'tournamentName', label: 'Tournament' },
          { key: 'date', label: 'Date' },
          { key: 'location', label: 'Location' },
          { key: 'player', label: 'Player' },
          { key: 'category', label: 'Category' },
          { key: 'weightCategory', label: 'Weight' },
          { key: 'result', label: 'Result' },
          { key: 'position', label: 'Position' },
          { key: 'medal', label: 'Medal' },
          { key: 'remarks', label: 'Remarks' },
        ],
        rows: data.rows,
      };
    }
    case 'medals': {
      const data = await reportMedals({ ...query, page: 1, limit: 5000 });
      return {
        sheetName: 'Medal Records',
        columns: [
          { key: 'player', label: 'Player' },
          { key: 'tournament', label: 'Tournament' },
          { key: 'medal', label: 'Medal' },
          { key: 'category', label: 'Category' },
          { key: 'date', label: 'Date' },
        ],
        rows: data.rows,
      };
    }
    case 'pending-fees': {
      const data = await reportPendingFees({ ...query, page: 1, limit: 5000 });
      return {
        sheetName: 'Pending Fees',
        columns: [
          { key: 'player', label: 'Player' },
          { key: 'registrationNumber', label: 'Reg No' },
          { key: 'feeType', label: 'Fee Type' },
          { key: 'totalFee', label: 'Total Fee' },
          { key: 'paidAmount', label: 'Paid' },
          { key: 'pendingAmount', label: 'Pending' },
          { key: 'dueDateLabel', label: 'Due Date' },
          { key: 'status', label: 'Status' },
        ],
        rows: data.rows.map((r) => ({
          ...r,
          player: r.student?.fullName,
          registrationNumber: r.student?.registrationNumber,
        })),
      };
    }
    case 'salary': {
      const data = await reportEmployeeSalary({ ...query, page: 1, limit: 5000 });
      return {
        sheetName: 'Employee Salary',
        columns: [
          { key: 'employeeName', label: 'Employee' },
          { key: 'role', label: 'Role' },
          { key: 'category', label: 'Category' },
          { key: 'salary', label: 'Salary' },
          { key: 'paymentDateLabel', label: 'Payment Date' },
          { key: 'paidAmount', label: 'Paid' },
          { key: 'pendingAmount', label: 'Pending' },
          { key: 'paymentStatus', label: 'Status' },
          { key: 'monthLabel', label: 'Month' },
        ],
        rows: data.rows,
      };
    }
    case 'sponsorships': {
      const data = await reportSponsorshipDocuments({ ...query, page: 1, limit: 5000 });
      return {
        sheetName: 'Sponsorships',
        columns: [
          { key: 'sponsorName', label: 'Sponsor' },
          { key: 'sponsorshipType', label: 'Type' },
          { key: 'amount', label: 'Amount' },
          { key: 'derivedStatus', label: 'Status' },
          { key: 'documentName', label: 'Document' },
        ],
        rows: data.rows,
      };
    }
    case 'age-category': {
      const data = await reportAgeCategories(query);
      const flat = data.groups.flatMap((g) =>
        g.players.map((p) => ({
          ageCategory: g.category,
          registrationNumber: p.registrationNumber,
          fullName: p.fullName,
          status: p.status,
        }))
      );
      return {
        sheetName: 'Age Category',
        columns: [
          { key: 'ageCategory', label: 'Age Category' },
          { key: 'registrationNumber', label: 'Reg No' },
          { key: 'fullName', label: 'Player' },
          { key: 'status', label: 'Status' },
        ],
        rows: flat,
      };
    }
    case 'player-category': {
      const data = await reportPlayerCategories(query);
      const flat = data.groups.flatMap((g) =>
        g.players.map((p) => ({
          category: g.category,
          registrationNumber: p.registrationNumber,
          fullName: p.fullName,
          status: p.status,
        }))
      );
      return {
        sheetName: 'Player Category',
        columns: [
          { key: 'category', label: 'Category' },
          { key: 'registrationNumber', label: 'Reg No' },
          { key: 'fullName', label: 'Player' },
          { key: 'status', label: 'Status' },
        ],
        rows: flat,
      };
    }
    case 'weight-category': {
      const data = await reportWeightCategories(query);
      const flat = data.groups.flatMap((g) =>
        g.players.map((p) => ({
          weightCategory: g.category,
          registrationNumber: p.registrationNumber,
          fullName: p.fullName,
          ageCategory: p.resolvedAgeCategory,
          status: p.status,
        }))
      );
      return {
        sheetName: 'Weight Category',
        columns: [
          { key: 'weightCategory', label: 'Weight Category' },
          { key: 'fullName', label: 'Player' },
          { key: 'ageCategory', label: 'Age Category' },
          { key: 'status', label: 'Status' },
        ],
        rows: flat,
      };
    }
    default:
      throw Object.assign(new Error(`Unknown report: ${key}`), { statusCode: 400 });
  }
}
