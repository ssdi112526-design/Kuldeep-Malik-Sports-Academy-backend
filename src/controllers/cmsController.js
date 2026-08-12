import { body, param, query } from 'express-validator';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withId, withIds } from '../utils/serialize.js';
import { deleteUploadedFile, toPublicPath } from '../middleware/upload.js';
import { DEFAULT_WEBSITE_SETTINGS, WEBSITE_SETTING_KEY } from '../seed/seedCmsDefaults.js';
import { normalizeAchievementLabel, normalizeAchievementType } from '../utils/galleryAchievements.js';

const parseBool = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
};

const parseOrder = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const parsePage = (value, fallback = 1) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

const parseLimit = (value, fallback = 20) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 100);
};

const listQuery = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().trim(),
  query('active').optional().isIn(['true', 'false', 'all']),
];

const idParam = [param('id').isUUID().withMessage('Invalid id')];

/* ───────────── Programs ───────────── */

export const programCreateValidation = [
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }),
  body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 2000 }),
  body('displayOrder').optional(),
  body('isActive').optional(),
];

export const programUpdateValidation = [
  ...idParam,
  body('title').optional().trim().notEmpty().withMessage('Title cannot be empty').isLength({ max: 200 }),
  body('description')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Description cannot be empty')
    .isLength({ max: 2000 }),
  body('displayOrder').optional(),
  body('isActive').optional(),
];

export const listProgramsPublic = asyncHandler(async (_req, res) => {
  const items = await prisma.program.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ success: true, data: { programs: withIds(items) } });
});

export const listProgramsAdmin = asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 20);
  const search = (req.query.search || '').trim();
  const active = req.query.active || 'all';

  const where = {
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
    ...(active === 'true' && { isActive: true }),
    ...(active === 'false' && { isActive: false }),
  };

  const [total, items] = await Promise.all([
    prisma.program.count({ where }),
    prisma.program.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      programs: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const createProgram = asyncHandler(async (req, res) => {
  const image = req.file ? toPublicPath(req.file.filename) : null;
  if (!image) throw new ApiError(400, 'Image is required');

  const program = await prisma.program.create({
    data: {
      title: req.body.title.trim(),
      description: req.body.description.trim(),
      image,
      displayOrder: parseOrder(req.body.displayOrder, 0),
      isActive: parseBool(req.body.isActive, true),
    },
  });

  res.status(201).json({ success: true, message: 'Program created', data: { program: withId(program) } });
});

export const updateProgram = asyncHandler(async (req, res) => {
  const existing = await prisma.program.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Program not found');

  let image = existing.image;
  if (req.file) {
    deleteUploadedFile(existing.image);
    image = toPublicPath(req.file.filename);
  }

  const program = await prisma.program.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.title !== undefined && { title: req.body.title.trim() }),
      ...(req.body.description !== undefined && { description: req.body.description.trim() }),
      ...(req.body.displayOrder !== undefined && { displayOrder: parseOrder(req.body.displayOrder) }),
      ...(req.body.isActive !== undefined && { isActive: parseBool(req.body.isActive) }),
      image,
    },
  });

  res.json({ success: true, message: 'Program updated', data: { program: withId(program) } });
});

export const deleteProgram = asyncHandler(async (req, res) => {
  const existing = await prisma.program.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Program not found');

  await prisma.program.delete({ where: { id: req.params.id } });
  deleteUploadedFile(existing.image);

  res.json({ success: true, message: 'Program deleted' });
});

export const programListValidation = listQuery;
export const programIdValidation = idParam;

/* ───────────── Gallery ───────────── */

export const galleryCreateValidation = [
  body('title').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body('category').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('displayOrder').optional(),
  body('achievementType').optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
  body('achievementLabel').optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
];

export const galleryUpdateValidation = [
  ...idParam,
  body('title').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body('category').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('displayOrder').optional(),
  body('achievementType').optional({ checkFalsy: true }).trim().isLength({ max: 40 }),
  body('achievementLabel').optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
];

export const listGalleryPublic = asyncHandler(async (_req, res) => {
  const items = await prisma.galleryItem.findMany({
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ success: true, data: { gallery: withIds(items) } });
});

export const listGalleryAdmin = asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 20);
  const search = (req.query.search || '').trim();

  const where = search
    ? {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, items] = await Promise.all([
    prisma.galleryItem.count({ where }),
    prisma.galleryItem.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      gallery: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const createGalleryItem = asyncHandler(async (req, res) => {
  const files = req.files?.length ? req.files : req.file ? [req.file] : [];
  if (!files.length) throw new ApiError(400, 'At least one image is required');

  const baseOrder = parseOrder(req.body.displayOrder, 0);
  const category = (req.body.category || 'General').trim() || 'General';
  const title = req.body.title?.trim() || null;
  const achievementType = normalizeAchievementType(req.body.achievementType);
  const achievementLabel = normalizeAchievementLabel(achievementType, req.body.achievementLabel);

  const created = await prisma.$transaction(
    files.map((file, index) =>
      prisma.galleryItem.create({
        data: {
          title: files.length === 1 ? title : title ? `${title} ${index + 1}` : null,
          category,
          image: toPublicPath(file.filename),
          displayOrder: baseOrder + index,
          achievementType,
          achievementLabel,
        },
      })
    )
  );

  res.status(201).json({
    success: true,
    message: `${created.length} image(s) uploaded`,
    data: { gallery: withIds(created) },
  });
});

export const updateGalleryItem = asyncHandler(async (req, res) => {
  const existing = await prisma.galleryItem.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Gallery item not found');

  let image = existing.image;
  if (req.file) {
    deleteUploadedFile(existing.image);
    image = toPublicPath(req.file.filename);
  }

  const data = {
    ...(req.body.title !== undefined && { title: req.body.title.trim() || null }),
    ...(req.body.category !== undefined && { category: req.body.category.trim() || 'General' }),
    ...(req.body.displayOrder !== undefined && { displayOrder: parseOrder(req.body.displayOrder) }),
    image,
  };

  if (req.body.achievementType !== undefined) {
    const nextType = normalizeAchievementType(req.body.achievementType);
    data.achievementType = nextType;
    // Type change without an explicit label should use the default label for the new type
    // (do not keep a stale previous medal label).
    data.achievementLabel = normalizeAchievementLabel(
      nextType,
      req.body.achievementLabel !== undefined ? req.body.achievementLabel : ''
    );
  } else if (req.body.achievementLabel !== undefined) {
    data.achievementLabel = normalizeAchievementLabel(existing.achievementType, req.body.achievementLabel);
  }

  const item = await prisma.galleryItem.update({
    where: { id: req.params.id },
    data,
  });

  res.json({ success: true, message: 'Gallery item updated', data: { item: withId(item) } });
});

export const deleteGalleryItem = asyncHandler(async (req, res) => {
  const existing = await prisma.galleryItem.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Gallery item not found');

  await prisma.galleryItem.delete({ where: { id: req.params.id } });
  deleteUploadedFile(existing.image);

  res.json({ success: true, message: 'Gallery item deleted' });
});

export const galleryListValidation = listQuery;
export const galleryIdValidation = idParam;

/* ───────────── Facilities ───────────── */

export const facilityCreateValidation = [
  body('name').trim().notEmpty().withMessage('Facility name is required').isLength({ max: 200 }),
  body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 2000 }),
  body('icon').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('displayOrder').optional(),
  body('isActive').optional(),
];

export const facilityUpdateValidation = [
  ...idParam,
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 200 }),
  body('description')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Description cannot be empty')
    .isLength({ max: 2000 }),
  body('icon').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('displayOrder').optional(),
  body('isActive').optional(),
];

export const listFacilitiesPublic = asyncHandler(async (_req, res) => {
  const items = await prisma.facility.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ success: true, data: { facilities: withIds(items) } });
});

export const listFacilitiesAdmin = asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 20);
  const search = (req.query.search || '').trim();
  const active = req.query.active || 'all';

  const where = {
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
    ...(active === 'true' && { isActive: true }),
    ...(active === 'false' && { isActive: false }),
  };

  const [total, items] = await Promise.all([
    prisma.facility.count({ where }),
    prisma.facility.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      facilities: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const createFacility = asyncHandler(async (req, res) => {
  const image = req.file ? toPublicPath(req.file.filename) : null;
  if (!image) throw new ApiError(400, 'Image is required');

  const facility = await prisma.facility.create({
    data: {
      name: req.body.name.trim(),
      description: req.body.description.trim(),
      icon: req.body.icon?.trim() || null,
      image,
      displayOrder: parseOrder(req.body.displayOrder, 0),
      isActive: parseBool(req.body.isActive, true),
    },
  });

  res.status(201).json({ success: true, message: 'Facility created', data: { facility: withId(facility) } });
});

export const updateFacility = asyncHandler(async (req, res) => {
  const existing = await prisma.facility.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Facility not found');

  let image = existing.image;
  if (req.file) {
    deleteUploadedFile(existing.image);
    image = toPublicPath(req.file.filename);
  }

  const facility = await prisma.facility.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.name !== undefined && { name: req.body.name.trim() }),
      ...(req.body.description !== undefined && { description: req.body.description.trim() }),
      ...(req.body.icon !== undefined && { icon: req.body.icon.trim() || null }),
      ...(req.body.displayOrder !== undefined && { displayOrder: parseOrder(req.body.displayOrder) }),
      ...(req.body.isActive !== undefined && { isActive: parseBool(req.body.isActive) }),
      image,
    },
  });

  res.json({ success: true, message: 'Facility updated', data: { facility: withId(facility) } });
});

export const deleteFacility = asyncHandler(async (req, res) => {
  const existing = await prisma.facility.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Facility not found');

  await prisma.facility.delete({ where: { id: req.params.id } });
  deleteUploadedFile(existing.image);

  res.json({ success: true, message: 'Facility deleted' });
});

export const facilityListValidation = listQuery;
export const facilityIdValidation = idParam;

/* ───────────── Features ───────────── */

export const featureCreateValidation = [
  body('titleEn').trim().notEmpty().withMessage('English title is required').isLength({ max: 200 }),
  body('titleHi').trim().notEmpty().withMessage('Hindi title is required').isLength({ max: 200 }),
  body('descriptionEn')
    .trim()
    .notEmpty()
    .withMessage('English description is required')
    .isLength({ max: 1000 }),
  body('descriptionHi')
    .trim()
    .notEmpty()
    .withMessage('Hindi description is required')
    .isLength({ max: 1000 }),
  body('icon').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('displayOrder').optional(),
  body('isActive').optional(),
];

export const featureUpdateValidation = [
  ...idParam,
  body('titleEn').optional().trim().notEmpty().withMessage('English title cannot be empty').isLength({ max: 200 }),
  body('titleHi').optional().trim().notEmpty().withMessage('Hindi title cannot be empty').isLength({ max: 200 }),
  body('descriptionEn')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('English description cannot be empty')
    .isLength({ max: 1000 }),
  body('descriptionHi')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Hindi description cannot be empty')
    .isLength({ max: 1000 }),
  body('icon').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('displayOrder').optional(),
  body('isActive').optional(),
];

export const listFeaturesPublic = asyncHandler(async (_req, res) => {
  const items = await prisma.feature.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ success: true, data: { features: withIds(items) } });
});

export const listFeaturesAdmin = asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 20);
  const search = (req.query.search || '').trim();
  const active = req.query.active || 'all';

  const where = {
    ...(search && {
      OR: [
        { titleEn: { contains: search, mode: 'insensitive' } },
        { titleHi: { contains: search, mode: 'insensitive' } },
        { descriptionEn: { contains: search, mode: 'insensitive' } },
        { descriptionHi: { contains: search, mode: 'insensitive' } },
      ],
    }),
    ...(active === 'true' && { isActive: true }),
    ...(active === 'false' && { isActive: false }),
  };

  const [total, items] = await Promise.all([
    prisma.feature.count({ where }),
    prisma.feature.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      features: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const createFeature = asyncHandler(async (req, res) => {
  const image = req.file ? toPublicPath(req.file.filename) : null;

  const feature = await prisma.feature.create({
    data: {
      titleEn: req.body.titleEn.trim(),
      titleHi: req.body.titleHi.trim(),
      descriptionEn: req.body.descriptionEn.trim(),
      descriptionHi: req.body.descriptionHi.trim(),
      icon: req.body.icon?.trim() || null,
      image,
      displayOrder: parseOrder(req.body.displayOrder, 0),
      isActive: parseBool(req.body.isActive, true),
    },
  });

  res.status(201).json({ success: true, message: 'Feature created', data: { feature: withId(feature) } });
});

export const updateFeature = asyncHandler(async (req, res) => {
  const existing = await prisma.feature.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Feature not found');

  let image = existing.image;
  if (req.file) {
    deleteUploadedFile(existing.image);
    image = toPublicPath(req.file.filename);
  }

  const feature = await prisma.feature.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.titleEn !== undefined && { titleEn: req.body.titleEn.trim() }),
      ...(req.body.titleHi !== undefined && { titleHi: req.body.titleHi.trim() }),
      ...(req.body.descriptionEn !== undefined && { descriptionEn: req.body.descriptionEn.trim() }),
      ...(req.body.descriptionHi !== undefined && { descriptionHi: req.body.descriptionHi.trim() }),
      ...(req.body.icon !== undefined && { icon: req.body.icon.trim() || null }),
      ...(req.body.displayOrder !== undefined && { displayOrder: parseOrder(req.body.displayOrder) }),
      ...(req.body.isActive !== undefined && { isActive: parseBool(req.body.isActive) }),
      image,
    },
  });

  res.json({ success: true, message: 'Feature updated', data: { feature: withId(feature) } });
});

export const deleteFeature = asyncHandler(async (req, res) => {
  const existing = await prisma.feature.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Feature not found');

  await prisma.feature.delete({ where: { id: req.params.id } });
  deleteUploadedFile(existing.image);

  res.json({ success: true, message: 'Feature deleted' });
});

export const featureListValidation = listQuery;
export const featureIdValidation = idParam;

/* ───────────── Membership plans ───────────── */

const normalizeBenefits = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
};

export const membershipCreateValidation = [
  body('name').trim().notEmpty().withMessage('Plan name is required').isLength({ max: 200 }),
  body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 2000 }),
  body('priceLabel').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('benefits').optional({ checkFalsy: true }),
  body('displayOrder').optional(),
  body('isActive').optional(),
];

export const membershipUpdateValidation = [
  ...idParam,
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 200 }),
  body('description')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Description cannot be empty')
    .isLength({ max: 2000 }),
  body('priceLabel').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('benefits').optional({ checkFalsy: true }),
  body('displayOrder').optional(),
  body('isActive').optional(),
];

export const listMembershipPlansPublic = asyncHandler(async (_req, res) => {
  const items = await prisma.membershipPlan.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ success: true, data: { membershipPlans: withIds(items) } });
});

export const listMembershipPlansAdmin = asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 20);
  const search = (req.query.search || '').trim();
  const active = req.query.active || 'all';

  const where = {
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { priceLabel: { contains: search, mode: 'insensitive' } },
        { benefits: { contains: search, mode: 'insensitive' } },
      ],
    }),
    ...(active === 'true' && { isActive: true }),
    ...(active === 'false' && { isActive: false }),
  };

  const [total, items] = await Promise.all([
    prisma.membershipPlan.count({ where }),
    prisma.membershipPlan.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      membershipPlans: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    },
  });
});

export const createMembershipPlan = asyncHandler(async (req, res) => {
  const image = req.file ? toPublicPath(req.file.filename) : null;

  const plan = await prisma.membershipPlan.create({
    data: {
      name: req.body.name.trim(),
      description: req.body.description.trim(),
      priceLabel: req.body.priceLabel?.trim() || null,
      benefits: normalizeBenefits(req.body.benefits),
      image,
      displayOrder: parseOrder(req.body.displayOrder, 0),
      isActive: parseBool(req.body.isActive, true),
    },
  });

  res.status(201).json({ success: true, message: 'Membership plan created', data: { membershipPlan: withId(plan) } });
});

export const updateMembershipPlan = asyncHandler(async (req, res) => {
  const existing = await prisma.membershipPlan.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Membership plan not found');

  let image = existing.image;
  if (req.file) {
    deleteUploadedFile(existing.image);
    image = toPublicPath(req.file.filename);
  }

  const plan = await prisma.membershipPlan.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.name !== undefined && { name: req.body.name.trim() }),
      ...(req.body.description !== undefined && { description: req.body.description.trim() }),
      ...(req.body.priceLabel !== undefined && { priceLabel: req.body.priceLabel.trim() || null }),
      ...(req.body.benefits !== undefined && { benefits: normalizeBenefits(req.body.benefits) }),
      ...(req.body.displayOrder !== undefined && { displayOrder: parseOrder(req.body.displayOrder) }),
      ...(req.body.isActive !== undefined && { isActive: parseBool(req.body.isActive) }),
      image,
    },
  });

  res.json({ success: true, message: 'Membership plan updated', data: { membershipPlan: withId(plan) } });
});

export const deleteMembershipPlan = asyncHandler(async (req, res) => {
  const existing = await prisma.membershipPlan.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Membership plan not found');

  await prisma.membershipPlan.delete({ where: { id: req.params.id } });
  deleteUploadedFile(existing.image);

  res.json({ success: true, message: 'Membership plan deleted' });
});

export const membershipListValidation = listQuery;
export const membershipIdValidation = idParam;

/* ───────────── Site settings (website) ───────────── */

export { DEFAULT_WEBSITE_SETTINGS, WEBSITE_SETTING_KEY };

const deepMerge = (base, patch) => {
  if (patch === undefined) return base;
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const source = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  const out = { ...source };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(source[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

const parseJsonBody = (raw, fieldName = 'value') => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, `Invalid JSON for ${fieldName}`);
  }
};

const getWebsiteSettingsRow = async () => {
  let row = await prisma.siteSetting.findUnique({ where: { key: WEBSITE_SETTING_KEY } });
  if (!row) {
    row = await prisma.siteSetting.create({
      data: { key: WEBSITE_SETTING_KEY, value: DEFAULT_WEBSITE_SETTINGS },
    });
  }
  const value = deepMerge(DEFAULT_WEBSITE_SETTINGS, row.value || {});
  return { ...row, value };
};

export const getSiteSettingsPublic = asyncHandler(async (_req, res) => {
  const setting = await getWebsiteSettingsRow();
  res.json({ success: true, data: { siteSettings: withId(setting) } });
});

export const getSiteSettingsAdmin = asyncHandler(async (_req, res) => {
  const setting = await getWebsiteSettingsRow();
  res.json({ success: true, data: { siteSettings: withId(setting) } });
});

export const siteSettingUpdateValidation = [
  body('value').optional(),
  body('company').optional(),
  body('social').optional(),
  body('hero').optional(),
  body('about').optional(),
];

export const updateSiteSetting = asyncHandler(async (req, res) => {
  const existing = await getWebsiteSettingsRow();
  let nextValue = { ...existing.value };

  const patchFromValue = parseJsonBody(req.body.value, 'value');
  if (patchFromValue !== undefined) {
    nextValue = deepMerge(nextValue, patchFromValue);
  }

  for (const section of ['company', 'social', 'hero', 'about']) {
    if (req.body[section] !== undefined) {
      const sectionPatch = parseJsonBody(req.body[section], section);
      if (section === 'social') {
        nextValue.social = Array.isArray(sectionPatch) ? sectionPatch : nextValue.social;
      } else if (sectionPatch && typeof sectionPatch === 'object') {
        nextValue[section] = deepMerge(nextValue[section] || {}, sectionPatch);
      }
    }
  }

  const files = req.files || {};
  const heroUpload = files.heroImage?.[0];
  const aboutUpload = files.aboutImage?.[0];

  if (heroUpload) {
    deleteUploadedFile(nextValue?.hero?.image);
    nextValue.hero = { ...(nextValue.hero || {}), image: toPublicPath(heroUpload.filename) };
  }
  if (aboutUpload) {
    deleteUploadedFile(nextValue?.about?.image);
    nextValue.about = { ...(nextValue.about || {}), image: toPublicPath(aboutUpload.filename) };
  }

  const setting = await prisma.siteSetting.update({
    where: { key: WEBSITE_SETTING_KEY },
    data: { value: nextValue },
  });

  res.json({
    success: true,
    message: 'Site settings updated',
    data: { siteSettings: withId({ ...setting, value: deepMerge(DEFAULT_WEBSITE_SETTINGS, setting.value || {}) }) },
  });
});

/* ───────────── Dashboard stats ───────────── */

/** Avoid "Cannot read properties of undefined (reading 'count')" if Prisma client is stale. */
const safeCount = (delegate, args) =>
  delegate && typeof delegate.count === 'function' ? delegate.count(args) : Promise.resolve(0);

const safeFindMany = (delegate, args) =>
  delegate && typeof delegate.findMany === 'function' ? delegate.findMany(args) : Promise.resolve([]);

const safeAggregate = (delegate, args) =>
  delegate && typeof delegate.aggregate === 'function'
    ? delegate.aggregate(args)
    : Promise.resolve({ _sum: {} });

export const getContentStats = asyncHandler(async (_req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    programs,
    gallery,
    facilities,
    videos,
    publishedVideos,
    draftVideos,
    featuredVideos,
    sizeAgg,
    totalStudents,
    totalCoaches,
    totalFeatures,
    totalMembershipPlans,
    totalInquiries,
    todayInquiries,
    totalAchievements,
    recentInquiries,
    recentStudents,
  ] = await Promise.all([
    safeCount(prisma.program),
    safeCount(prisma.galleryItem),
    safeCount(prisma.facility),
    safeCount(prisma.video),
    safeCount(prisma.video, { where: { status: 'published' } }),
    safeCount(prisma.video, { where: { status: 'draft' } }),
    safeCount(prisma.video, { where: { isFeatured: true } }),
    safeAggregate(prisma.video, { _sum: { fileSize: true } }),
    safeCount(prisma.student),
    safeCount(prisma.coach),
    safeCount(prisma.feature),
    safeCount(prisma.membershipPlan),
    safeCount(prisma.contact),
    safeCount(prisma.contact, { where: { createdAt: { gte: startOfToday } } }),
    safeCount(prisma.achievement),
    safeFindMany(prisma.contact, {
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, fullName: true, email: true, createdAt: true },
    }),
    safeFindMany(prisma.student, {
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, fullName: true, registrationNumber: true, createdAt: true },
    }),
  ]);

  res.json({
    success: true,
    data: {
      totalPrograms: programs,
      totalGallery: gallery,
      totalFacilities: facilities,
      totalVideos: videos,
      publishedVideos,
      draftVideos,
      featuredVideos,
      totalStorageBytes: sizeAgg?._sum?.fileSize || 0,
      totalStudents,
      totalCoaches,
      totalFeatures,
      totalMembershipPlans,
      totalInquiries,
      todayInquiries,
      totalAchievements,
      recentInquiries: withIds(recentInquiries),
      recentStudents: withIds(
        recentStudents.map((s) => ({
          ...s,
          studentCode: s.registrationNumber,
        }))
      ),
    },
  });
});
