import { body, param, query } from 'express-validator';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withId, withIds } from '../utils/serialize.js';

function parsePaging(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

/* ---------------- Achievements ---------------- */

export const listAchievementsPublic = asyncHandler(async (_req, res) => {
  const items = await prisma.achievement.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ success: true, data: { achievements: withIds(items) } });
});

export const listAchievementsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req);
  const search = (req.query.search || '').trim();
  const where = search
    ? {
        OR: [
          { labelEn: { contains: search, mode: 'insensitive' } },
          { labelHi: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, items] = await Promise.all([
    prisma.achievement.count({ where }),
    prisma.achievement.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      achievements: withIds(items),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

export const createAchievement = asyncHandler(async (req, res) => {
  const { labelEn, labelHi, value = 0, suffix = '+', displayOrder = 0, isActive = true } = req.body;
  if (!labelEn?.trim() || !labelHi?.trim()) {
    throw new ApiError(400, 'English and Hindi labels are required');
  }
  const item = await prisma.achievement.create({
    data: {
      labelEn: labelEn.trim(),
      labelHi: labelHi.trim(),
      value: Number(value) || 0,
      suffix: String(suffix || '+').slice(0, 10),
      displayOrder: Number(displayOrder) || 0,
      isActive: isActive === true || isActive === 'true',
    },
  });
  res.status(201).json({ success: true, message: 'Achievement created', data: { achievement: withId(item) } });
});

export const updateAchievement = asyncHandler(async (req, res) => {
  const existing = await prisma.achievement.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Achievement not found');

  const data = {};
  if (req.body.labelEn != null) data.labelEn = String(req.body.labelEn).trim();
  if (req.body.labelHi != null) data.labelHi = String(req.body.labelHi).trim();
  if (req.body.value != null) data.value = Number(req.body.value) || 0;
  if (req.body.suffix != null) data.suffix = String(req.body.suffix).slice(0, 10);
  if (req.body.displayOrder != null) data.displayOrder = Number(req.body.displayOrder) || 0;
  if (req.body.isActive != null) data.isActive = req.body.isActive === true || req.body.isActive === 'true';

  const item = await prisma.achievement.update({ where: { id: existing.id }, data });
  res.json({ success: true, message: 'Achievement updated', data: { achievement: withId(item) } });
});

export const deleteAchievement = asyncHandler(async (req, res) => {
  const existing = await prisma.achievement.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Achievement not found');
  await prisma.achievement.delete({ where: { id: existing.id } });
  res.json({ success: true, message: 'Achievement deleted' });
});

/* ---------------- Schedule (sessions + days) ---------------- */

export const listSchedulePublic = asyncHandler(async (_req, res) => {
  const [sessions, days] = await Promise.all([
    prisma.scheduleSession.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.scheduleDay.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  res.json({
    success: true,
    data: { sessions: withIds(sessions), days: withIds(days) },
  });
});

export const listScheduleSessionsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req);
  const [total, items] = await Promise.all([
    prisma.scheduleSession.count(),
    prisma.scheduleSession.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      skip,
      take: limit,
    }),
  ]);
  res.json({
    success: true,
    data: {
      sessions: withIds(items),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

export const createScheduleSession = asyncHandler(async (req, res) => {
  const { key, titleEn, titleHi, timeEn, timeHi, noteEn, noteHi, displayOrder = 0, isActive = true } = req.body;
  if (!key?.trim() || !titleEn?.trim() || !titleHi?.trim() || !timeEn?.trim() || !timeHi?.trim()) {
    throw new ApiError(400, 'Key, titles and times are required');
  }
  const exists = await prisma.scheduleSession.findUnique({ where: { key: key.trim() } });
  if (exists) throw new ApiError(400, 'Session key already exists');

  const item = await prisma.scheduleSession.create({
    data: {
      key: key.trim().toLowerCase(),
      titleEn: titleEn.trim(),
      titleHi: titleHi.trim(),
      timeEn: timeEn.trim(),
      timeHi: timeHi.trim(),
      noteEn: noteEn?.trim() || null,
      noteHi: noteHi?.trim() || null,
      displayOrder: Number(displayOrder) || 0,
      isActive: isActive === true || isActive === 'true',
    },
  });
  res.status(201).json({ success: true, message: 'Session created', data: { session: withId(item) } });
});

export const updateScheduleSession = asyncHandler(async (req, res) => {
  const existing = await prisma.scheduleSession.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Session not found');

  const data = {};
  ['titleEn', 'titleHi', 'timeEn', 'timeHi', 'noteEn', 'noteHi'].forEach((f) => {
    if (req.body[f] !== undefined) data[f] = req.body[f] == null ? null : String(req.body[f]).trim();
  });
  if (req.body.displayOrder != null) data.displayOrder = Number(req.body.displayOrder) || 0;
  if (req.body.isActive != null) data.isActive = req.body.isActive === true || req.body.isActive === 'true';

  const item = await prisma.scheduleSession.update({ where: { id: existing.id }, data });
  res.json({ success: true, message: 'Session updated', data: { session: withId(item) } });
});

export const deleteScheduleSession = asyncHandler(async (req, res) => {
  const existing = await prisma.scheduleSession.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Session not found');
  await prisma.scheduleSession.delete({ where: { id: existing.id } });
  res.json({ success: true, message: 'Session deleted' });
});

export const listScheduleDaysAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req);
  const [total, items] = await Promise.all([
    prisma.scheduleDay.count(),
    prisma.scheduleDay.findMany({
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      skip,
      take: limit,
    }),
  ]);
  res.json({
    success: true,
    data: {
      days: withIds(items),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

export const createScheduleDay = asyncHandler(async (req, res) => {
  const {
    dayKey,
    labelEn,
    labelHi,
    morningEn,
    morningHi,
    eveningEn,
    eveningHi,
    isHoliday = false,
    displayOrder = 0,
    isActive = true,
  } = req.body;

  if (!dayKey?.trim() || !labelEn?.trim() || !labelHi?.trim()) {
    throw new ApiError(400, 'Day key and labels are required');
  }
  const exists = await prisma.scheduleDay.findUnique({ where: { dayKey: dayKey.trim().toLowerCase() } });
  if (exists) throw new ApiError(400, 'Day already exists');

  const item = await prisma.scheduleDay.create({
    data: {
      dayKey: dayKey.trim().toLowerCase(),
      labelEn: labelEn.trim(),
      labelHi: labelHi.trim(),
      morningEn: (morningEn || '').trim(),
      morningHi: (morningHi || '').trim(),
      eveningEn: (eveningEn || '').trim(),
      eveningHi: (eveningHi || '').trim(),
      isHoliday: isHoliday === true || isHoliday === 'true',
      displayOrder: Number(displayOrder) || 0,
      isActive: isActive === true || isActive === 'true',
    },
  });
  res.status(201).json({ success: true, message: 'Day created', data: { day: withId(item) } });
});

export const updateScheduleDay = asyncHandler(async (req, res) => {
  const existing = await prisma.scheduleDay.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Day not found');

  const data = {};
  ['labelEn', 'labelHi', 'morningEn', 'morningHi', 'eveningEn', 'eveningHi'].forEach((f) => {
    if (req.body[f] !== undefined) data[f] = String(req.body[f] ?? '').trim();
  });
  if (req.body.isHoliday != null) data.isHoliday = req.body.isHoliday === true || req.body.isHoliday === 'true';
  if (req.body.displayOrder != null) data.displayOrder = Number(req.body.displayOrder) || 0;
  if (req.body.isActive != null) data.isActive = req.body.isActive === true || req.body.isActive === 'true';

  const item = await prisma.scheduleDay.update({ where: { id: existing.id }, data });
  res.json({ success: true, message: 'Day updated', data: { day: withId(item) } });
});

export const deleteScheduleDay = asyncHandler(async (req, res) => {
  const existing = await prisma.scheduleDay.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Day not found');
  await prisma.scheduleDay.delete({ where: { id: existing.id } });
  res.json({ success: true, message: 'Day deleted' });
});

export const idParamValidation = [param('id').isUUID().withMessage('Invalid id')];
export const listValidation = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];
