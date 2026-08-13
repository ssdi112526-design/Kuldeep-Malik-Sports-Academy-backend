import { body, param, query } from 'express-validator';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withId, withIds } from '../utils/serialize.js';
import { toPublicPath } from '../middleware/upload.js';
import { normalizeMedal } from '../constants/medals.js';
import bcrypt from 'bcryptjs';

const idParam = [param('id').isUUID().withMessage('Invalid id')];

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function resolveTournamentFields({ tournamentId, tournamentName }) {
  let tid = tournamentId && String(tournamentId).trim() ? String(tournamentId).trim() : null;
  let name = tournamentName?.trim() || null;
  if (tid) {
    const tournament = await prisma.tournament.findUnique({ where: { id: tid } });
    if (!tournament) throw new ApiError(404, 'Tournament not found');
    tid = tournament.id;
    name = tournament.name;
  }
  return { tournamentId: tid, tournamentName: name };
}

function publicAchievementShape(item) {
  const year =
    item.year ||
    (item.achievedOn ? new Date(item.achievedOn).getUTCFullYear() : null) ||
    (item.tournament?.eventDate ? new Date(item.tournament.eventDate).getUTCFullYear() : null);
  const displayName =
    String(item.playerName || '').trim() || item.student?.fullName || 'Player';
  return {
    id: item.id,
    _id: item.id,
    title: item.title,
    description: item.description || null,
    achievementType: item.achievementType || null,
    tournamentName: item.tournament?.name || item.tournamentName || null,
    tournamentId: item.tournamentId || null,
    location: item.tournament?.location || null,
    achievedOn: item.achievedOn || null,
    year,
    medal: item.medal || null,
    result: item.result || null,
    image: item.image || null,
    showOnWebsite: item.showOnWebsite !== false,
    playerName: displayName,
    ageCategory: item.student?.ageCategory || null,
    weightCategory: item.student?.weightCategory || null,
    playerCategory: item.student?.category || item.tournament?.category || null,
    player: {
      id: item.student?.id || null,
      fullName: displayName,
      photo: item.student?.photo || null,
    },
  };
}

function parseShowOnWebsite(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

async function getLinkedStudentIdsForParent(userId) {
  const profile = await prisma.parentProfile.findUnique({
    where: { userId },
    include: { links: { select: { studentId: true } } },
  });
  return profile?.links?.map((l) => l.studentId) || [];
}

export async function assertParentCanAccessStudent(userId, studentId) {
  const ids = await getLinkedStudentIdsForParent(userId);
  if (!ids.includes(studentId)) {
    throw new ApiError(403, 'You can only access your linked player data.');
  }
}

/* ───── Player Achievements (admin) ───── */

export const playerAchievementListValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().trim(),
  query('studentId').optional().isUUID(),
  query('tournamentId').optional().isUUID(),
  query('medal').optional().trim().isLength({ max: 40 }),
];

export const listPlayerAchievements = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const search = String(req.query.search || '').trim();
  const studentId = req.query.studentId;
  const medal = req.query.medal ? normalizeMedal(req.query.medal) : null;
  const tournamentId = req.query.tournamentId;

  const where = {
    ...(studentId ? { studentId } : {}),
    ...(tournamentId ? { tournamentId } : {}),
    ...(medal ? { medal: { equals: medal, mode: 'insensitive' } } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { playerName: { contains: search, mode: 'insensitive' } },
            { tournamentName: { contains: search, mode: 'insensitive' } },
            { student: { fullName: { contains: search, mode: 'insensitive' } } },
            { tournament: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, items, medalGroups, playerDistinct, tournamentDistinct] = await Promise.all([
    prisma.playerAchievement.count({ where }),
    prisma.playerAchievement.findMany({
      where,
      include: {
        student: { select: { id: true, fullName: true, registrationNumber: true, photo: true } },
        tournament: { select: { id: true, name: true, eventDate: true } },
      },
      orderBy: [{ achievedOn: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.playerAchievement.groupBy({
      by: ['medal'],
      _count: { _all: true },
    }),
    prisma.playerAchievement.findMany({
      select: { studentId: true, playerName: true },
    }),
    prisma.playerAchievement.findMany({
      where: { OR: [{ tournamentId: { not: null } }, { tournamentName: { not: null } }] },
      select: { tournamentId: true, tournamentName: true },
    }),
  ]);

  const medals = { Gold: 0, Silver: 0, Bronze: 0, Other: 0 };
  for (const row of medalGroups) {
    const key = normalizeMedal(row.medal);
    if (!key) continue;
    if (key === 'Gold' || key === 'Silver' || key === 'Bronze') medals[key] += row._count._all;
    else medals.Other += row._count._all;
  }

  const playerKeys = new Set();
  for (const row of playerDistinct) {
    if (row.studentId) playerKeys.add(`s:${row.studentId}`);
    else if (row.playerName?.trim()) playerKeys.add(`n:${row.playerName.trim().toLowerCase()}`);
  }

  const tournamentNames = new Set();
  for (const t of tournamentDistinct) {
    if (t.tournamentId) tournamentNames.add(t.tournamentId);
    else if (t.tournamentName) tournamentNames.add(t.tournamentName.toLowerCase());
  }

  res.json({
    success: true,
    data: {
      achievements: withIds(
        items.map((item) => ({
          ...item,
          displayPlayerName:
            String(item.playerName || '').trim() || item.student?.fullName || '—',
        }))
      ),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      summary: {
        total,
        playersWithAchievements: playerKeys.size,
        tournamentsRepresented: tournamentNames.size,
        medals,
      },
    },
  });
});

/** Public website — player achievements (read-only, no sensitive fields) */
export const listPlayerAchievementsPublic = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 48));
  const items = await prisma.playerAchievement.findMany({
    where: { showOnWebsite: true },
    include: {
      student: {
        select: {
          id: true,
          fullName: true,
          photo: true,
          ageCategory: true,
          weightCategory: true,
          category: true,
        },
      },
      tournament: {
        select: { id: true, name: true, eventDate: true, location: true, category: true },
      },
    },
    orderBy: [{ achievedOn: 'desc' }, { year: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  res.json({
    success: true,
    data: {
      achievements: items.map(publicAchievementShape),
    },
  });
});

export const playerAchievementWriteValidation = [
  body('playerName').trim().notEmpty().withMessage('Player name is required').isLength({ max: 150 }),
  body('studentId').optional({ checkFalsy: true }).isUUID().withMessage('Invalid player id'),
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
  body('achievementType').optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
  body('tournamentId').optional({ checkFalsy: true }).isUUID().withMessage('Invalid tournament'),
  body('tournamentName').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body('medal').optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
  body('result').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('year').optional({ checkFalsy: true }).isInt({ min: 1950, max: 2100 }),
  body('achievedOn').optional({ checkFalsy: true }),
  body('showOnWebsite').optional(),
];

export const createPlayerAchievement = asyncHandler(async (req, res) => {
  const playerName = String(req.body.playerName || '').trim();
  if (!playerName) throw new ApiError(400, 'Player name is required');

  let studentId = req.body.studentId || null;
  if (studentId) {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) throw new ApiError(404, 'Player not found');
  } else {
    studentId = null;
  }

  const { tournamentId, tournamentName } = await resolveTournamentFields({
    tournamentId: req.body.tournamentId,
    tournamentName: req.body.tournamentName,
  });

  const item = await prisma.playerAchievement.create({
    data: {
      studentId,
      playerName,
      title: req.body.title.trim(),
      description: req.body.description?.trim() || null,
      achievementType: req.body.achievementType?.trim() || null,
      tournamentId,
      tournamentName,
      medal: normalizeMedal(req.body.medal),
      result: req.body.result?.trim() || null,
      year: req.body.year ? Number(req.body.year) : null,
      achievedOn: parseDate(req.body.achievedOn),
      showOnWebsite: parseShowOnWebsite(req.body.showOnWebsite, true),
      image: req.file ? toPublicPath(req.file.filename) : null,
    },
    include: {
      student: { select: { id: true, fullName: true, registrationNumber: true, photo: true } },
      tournament: { select: { id: true, name: true, eventDate: true } },
    },
  });

  res.status(201).json({
    success: true,
    message: 'Achievement added',
    data: {
      achievement: withId({
        ...item,
        displayPlayerName: item.playerName || item.student?.fullName || '—',
      }),
    },
  });
});

export const updatePlayerAchievement = asyncHandler(async (req, res) => {
  const existing = await prisma.playerAchievement.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Achievement not found');

  let tournamentFields = {};
  if (req.body.tournamentId !== undefined || req.body.tournamentName !== undefined) {
    tournamentFields = await resolveTournamentFields({
      tournamentId: req.body.tournamentId !== undefined ? req.body.tournamentId : existing.tournamentId,
      tournamentName: req.body.tournamentName !== undefined ? req.body.tournamentName : existing.tournamentName,
    });
    if (req.body.tournamentId === '' || req.body.tournamentId === null) {
      tournamentFields = {
        tournamentId: null,
        tournamentName: req.body.tournamentName?.trim() || null,
      };
    }
  }

  if (req.body.studentId) {
    const student = await prisma.student.findUnique({ where: { id: req.body.studentId } });
    if (!student) throw new ApiError(404, 'Player not found');
  }

  const item = await prisma.playerAchievement.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.playerName !== undefined && {
        playerName: String(req.body.playerName || '').trim() || null,
      }),
      ...(req.body.studentId !== undefined && {
        studentId: req.body.studentId || null,
      }),
      ...(req.body.title !== undefined && { title: req.body.title.trim() }),
      ...(req.body.description !== undefined && { description: req.body.description?.trim() || null }),
      ...(req.body.achievementType !== undefined && {
        achievementType: req.body.achievementType?.trim() || null,
      }),
      ...tournamentFields,
      ...(req.body.medal !== undefined && { medal: normalizeMedal(req.body.medal) }),
      ...(req.body.result !== undefined && { result: req.body.result?.trim() || null }),
      ...(req.body.year !== undefined && { year: req.body.year ? Number(req.body.year) : null }),
      ...(req.body.achievedOn !== undefined && { achievedOn: parseDate(req.body.achievedOn) }),
      ...(req.body.showOnWebsite !== undefined && {
        showOnWebsite: parseShowOnWebsite(req.body.showOnWebsite, existing.showOnWebsite),
      }),
      ...(req.file && { image: toPublicPath(req.file.filename) }),
    },
    include: {
      student: { select: { id: true, fullName: true, registrationNumber: true, photo: true } },
      tournament: { select: { id: true, name: true, eventDate: true } },
    },
  });

  res.json({
    success: true,
    message: 'Achievement updated',
    data: {
      achievement: withId({
        ...item,
        displayPlayerName: item.playerName || item.student?.fullName || '—',
      }),
    },
  });
});

export const deletePlayerAchievement = asyncHandler(async (req, res) => {
  const existing = await prisma.playerAchievement.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Achievement not found');
  await prisma.playerAchievement.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Achievement deleted' });
});

export const playerAchievementIdValidation = idParam;

/* ───── Tournaments ───── */

export const listTournaments = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const search = String(req.query.search || '').trim();
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, items] = await Promise.all([
    prisma.tournament.count({ where }),
    prisma.tournament.findMany({
      where,
      include: {
        results: {
          include: {
            student: { select: { id: true, fullName: true, registrationNumber: true, photo: true } },
          },
        },
      },
      orderBy: { eventDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      tournaments: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const tournamentWriteValidation = [
  body('name').trim().notEmpty().isLength({ max: 200 }),
  body('eventDate').notEmpty(),
  body('location').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body('category').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('remarks').optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
];

export const createTournament = asyncHandler(async (req, res) => {
  const eventDate = parseDate(req.body.eventDate);
  if (!eventDate) throw new ApiError(400, 'Valid tournament date is required');

  const item = await prisma.tournament.create({
    data: {
      name: req.body.name.trim(),
      eventDate,
      location: req.body.location?.trim() || null,
      category: req.body.category?.trim() || null,
      remarks: req.body.remarks?.trim() || null,
      image: req.file ? toPublicPath(req.file.filename) : null,
    },
  });

  res.status(201).json({ success: true, message: 'Tournament created', data: { tournament: withId(item) } });
});

export const updateTournament = asyncHandler(async (req, res) => {
  const existing = await prisma.tournament.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Tournament not found');

  const item = await prisma.tournament.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.name !== undefined && { name: req.body.name.trim() }),
      ...(req.body.eventDate !== undefined && { eventDate: parseDate(req.body.eventDate) || existing.eventDate }),
      ...(req.body.location !== undefined && { location: req.body.location?.trim() || null }),
      ...(req.body.category !== undefined && { category: req.body.category?.trim() || null }),
      ...(req.body.remarks !== undefined && { remarks: req.body.remarks?.trim() || null }),
      ...(req.file && { image: toPublicPath(req.file.filename) }),
    },
  });

  res.json({ success: true, message: 'Tournament updated', data: { tournament: withId(item) } });
});

export const deleteTournament = asyncHandler(async (req, res) => {
  const existing = await prisma.tournament.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Tournament not found');
  await prisma.tournament.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Tournament deleted' });
});

export const tournamentResultWriteValidation = [
  body('studentId').isUUID(),
  body('category').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('result').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('position').optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
  body('medal').optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
  body('remarks').optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
];

export const upsertTournamentResult = asyncHandler(async (req, res) => {
  const tournament = await prisma.tournament.findUnique({ where: { id: req.params.id } });
  if (!tournament) throw new ApiError(404, 'Tournament not found');
  const student = await prisma.student.findUnique({ where: { id: req.body.studentId } });
  if (!student) throw new ApiError(404, 'Player not found');

  const item = await prisma.tournamentResult.upsert({
    where: {
      tournamentId_studentId: {
        tournamentId: req.params.id,
        studentId: req.body.studentId,
      },
    },
    create: {
      tournamentId: req.params.id,
      studentId: req.body.studentId,
      category: req.body.category?.trim() || null,
      result: req.body.result?.trim() || null,
      position: req.body.position?.trim() || null,
      medal: req.body.medal?.trim() || null,
      remarks: req.body.remarks?.trim() || null,
      image: req.file ? toPublicPath(req.file.filename) : null,
    },
    update: {
      category: req.body.category?.trim() || null,
      result: req.body.result?.trim() || null,
      position: req.body.position?.trim() || null,
      medal: req.body.medal?.trim() || null,
      remarks: req.body.remarks?.trim() || null,
      ...(req.file && { image: toPublicPath(req.file.filename) }),
    },
    include: { student: { select: { id: true, fullName: true, registrationNumber: true } } },
  });

  res.json({ success: true, message: 'Tournament result saved', data: { result: withId(item) } });
});

export const deleteTournamentResult = asyncHandler(async (req, res) => {
  const existing = await prisma.tournamentResult.findUnique({ where: { id: req.params.resultId } });
  if (!existing) throw new ApiError(404, 'Result not found');
  await prisma.tournamentResult.delete({ where: { id: req.params.resultId } });
  res.json({ success: true, message: 'Result deleted' });
});

/* ───── Parent admin link + portal ───── */

function parseStudentIds(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      /* single id or comma-separated */
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return raw ? [raw] : [];
}

export const createParentAccountValidation = [
  body('fullName').trim().notEmpty().isLength({ max: 150 }),
  body('email').trim().isEmail(),
  body('password').isLength({ min: 6 }),
  body('phone').optional({ checkFalsy: true }).trim(),
  body('relation').optional({ checkFalsy: true }).trim(),
  body('studentIds').custom((value) => {
    if (!parseStudentIds(value).length) {
      throw new Error('Link at least one player');
    }
    return true;
  }),
];

export const createParentAccount = asyncHandler(async (req, res) => {
  const email = String(req.body.email).trim().toLowerCase();
  const studentIds = [...new Set(parseStudentIds(req.body.studentIds))];
  if (!studentIds.length) throw new ApiError(400, 'Link at least one player');

  const students = await prisma.student.findMany({ where: { id: { in: studentIds } } });
  if (students.length !== studentIds.length) throw new ApiError(400, 'One or more players not found');

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new ApiError(400, 'A user with this email already exists');

  const parentRole = await prisma.role.findUnique({ where: { slug: 'parent' } });
  const hashed = await bcrypt.hash(String(req.body.password), 12);
  const photo = req.file ? toPublicPath(req.file.filename) : null;

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: req.body.fullName.trim(),
        email,
        mobile: req.body.phone?.trim() || null,
        password: hashed,
        role: 'parent',
        roleId: parentRole?.id || null,
        username: `parent_${Date.now().toString(36)}`,
        ...(photo ? { profileImage: photo } : {}),
      },
    });
    const profile = await tx.parentProfile.create({
      data: {
        userId: user.id,
        fullName: req.body.fullName.trim(),
        phone: req.body.phone?.trim() || null,
        email,
        relation: req.body.relation?.trim() || null,
        photo,
        links: {
          create: studentIds.map((studentId) => ({
            studentId,
            relation: req.body.relation?.trim() || null,
          })),
        },
      },
      include: {
        links: { include: { student: { select: { id: true, fullName: true, registrationNumber: true } } } },
      },
    });
    return { user, profile };
  });

  res.status(201).json({
    success: true,
    message: 'Parent account created',
    data: {
      parent: withId(created.profile),
      loginEmail: email,
    },
  });
});

export const listParents = asyncHandler(async (_req, res) => {
  const items = await prisma.parentProfile.findMany({
    include: {
      user: { select: { id: true, email: true, isActive: true, lastLoginAt: true } },
      links: {
        include: { student: { select: { id: true, fullName: true, registrationNumber: true, photo: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: { parents: withIds(items) } });
});

export const parentDashboard = asyncHandler(async (req, res) => {
  const profile = await prisma.parentProfile.findUnique({
    where: { userId: req.user.id },
    include: {
      links: {
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              registrationNumber: true,
              photo: true,
              batch: true,
              status: true,
              attendanceTotal: true,
              attendancePresent: true,
              attendanceAbsent: true,
              mobileNumber: true,
              dateOfBirth: true,
              membershipType: true,
            },
          },
        },
      },
    },
  });
  if (!profile) throw new ApiError(404, 'Parent profile not found');

  res.json({
    success: true,
    data: {
      parent: withId({
        id: profile.id,
        fullName: profile.fullName,
        phone: profile.phone,
        email: profile.email,
        relation: profile.relation,
        photo: profile.photo,
        children: profile.links.map((l) => ({
          ...withId(l.student),
          relation: l.relation,
          attendancePercent:
            l.student.attendanceTotal > 0
              ? Math.round((l.student.attendancePresent / l.student.attendanceTotal) * 100)
              : 0,
        })),
      }),
    },
  });
});

export const parentChildAttendance = asyncHandler(async (req, res) => {
  await assertParentCanAccessStudent(req.user.id, req.params.studentId);
  const { getStudentAttendanceHistory } = await import('../services/attendanceCalc.js');
  const { attendanceStatusLabel, normalizeAttendanceStatus } = await import(
    '../constants/attendanceStatus.js'
  );

  const periodInput = Object.keys(req.query || {}).length ? req.query : { period: 'month' };
  const history = await getStudentAttendanceHistory(req.params.studentId, periodInput);
  if (!history) throw new ApiError(404, 'Player not found');

  const s = history.summary || {};
  res.json({
    success: true,
    data: {
      student: withId(history.student),
      period: history.period,
      records: (history.history || []).map((r) => ({
        id: r.id || `${r.studentId}_${r.date}`,
        date: r.date,
        markedAt: r.markedAt,
        status: r.statusKey || normalizeAttendanceStatus(r.status) || 'absent',
        statusLabel: r.statusLabel || attendanceStatusLabel(r.status) || r.status,
        checkIn: r.checkIn || '',
      })),
      summary: {
        total: s.trainingDays || 0,
        trainingDays: s.trainingDays || 0,
        present: s.presentDays || 0,
        absent: s.absentDays || 0,
        leave: s.leaveDays || 0,
        medicalLeave: s.medicalLeaveDays || 0,
        competitionLeave: s.competitionLeaveDays || 0,
        percent: s.attendancePercentage || 0,
        attendancePercentage: s.attendancePercentage || 0,
      },
    },
  });
});

export const parentChildAchievements = asyncHandler(async (req, res) => {
  await assertParentCanAccessStudent(req.user.id, req.params.studentId);
  const items = await prisma.playerAchievement.findMany({
    where: { studentId: req.params.studentId },
    include: { tournament: { select: { id: true, name: true, eventDate: true } } },
    orderBy: [{ achievedOn: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({
    success: true,
    data: {
      achievements: withIds(
        items.map((item) => ({
          ...item,
          tournamentName: item.tournament?.name || item.tournamentName,
        }))
      ),
    },
  });
});

export const parentChildTournaments = asyncHandler(async (req, res) => {
  await assertParentCanAccessStudent(req.user.id, req.params.studentId);
  const items = await prisma.tournamentResult.findMany({
    where: { studentId: req.params.studentId },
    include: { tournament: true },
    orderBy: { tournament: { eventDate: 'desc' } },
  });
  res.json({ success: true, data: { results: withIds(items) } });
});

/* Player self */
export const myPlayerAchievements = asyncHandler(async (req, res) => {
  const items = await prisma.playerAchievement.findMany({
    where: { studentId: req.user.studentId },
    include: { tournament: { select: { id: true, name: true, eventDate: true } } },
    orderBy: [{ achievedOn: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({
    success: true,
    data: {
      achievements: withIds(
        items.map((item) => ({
          ...item,
          tournamentName: item.tournament?.name || item.tournamentName,
        }))
      ),
    },
  });
});

export const myPlayerTournaments = asyncHandler(async (req, res) => {
  const items = await prisma.tournamentResult.findMany({
    where: { studentId: req.user.studentId },
    include: { tournament: true },
    orderBy: { tournament: { eventDate: 'desc' } },
  });
  res.json({ success: true, data: { results: withIds(items) } });
});
