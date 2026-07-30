import { body, param, query } from 'express-validator';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withId, withIds } from '../utils/serialize.js';
import { deleteUploadedFile, toPublicPath } from '../middleware/upload.js';

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
];

export const galleryUpdateValidation = [
  ...idParam,
  body('title').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body('category').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('displayOrder').optional(),
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

  const created = await prisma.$transaction(
    files.map((file, index) =>
      prisma.galleryItem.create({
        data: {
          title: files.length === 1 ? title : title ? `${title} ${index + 1}` : null,
          category,
          image: toPublicPath(file.filename),
          displayOrder: baseOrder + index,
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

  const item = await prisma.galleryItem.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.title !== undefined && { title: req.body.title.trim() || null }),
      ...(req.body.category !== undefined && { category: req.body.category.trim() || 'General' }),
      ...(req.body.displayOrder !== undefined && { displayOrder: parseOrder(req.body.displayOrder) }),
      image,
    },
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

/* ───────────── Dashboard stats ───────────── */

export const getContentStats = asyncHandler(async (_req, res) => {
  const [programs, gallery, facilities, videos, publishedVideos, draftVideos, featuredVideos, sizeAgg] =
    await Promise.all([
      prisma.program.count(),
      prisma.galleryItem.count(),
      prisma.facility.count(),
      prisma.video.count(),
      prisma.video.count({ where: { status: 'published' } }),
      prisma.video.count({ where: { status: 'draft' } }),
      prisma.video.count({ where: { isFeatured: true } }),
      prisma.video.aggregate({ _sum: { fileSize: true } }),
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
      totalStorageBytes: sizeAgg._sum.fileSize || 0,
    },
  });
});
