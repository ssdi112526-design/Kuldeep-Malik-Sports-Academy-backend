import { body, param, query } from 'express-validator';
import path from 'path';
import fs from 'fs';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withId, withIds } from '../utils/serialize.js';
import { deleteUploadedFile, toPublicPath, UPLOADS_DIR, VIDEOS_DIR } from '../middleware/upload.js';
import {
  generateVideoThumbnail,
  getVideoDurationLabel,
} from '../services/videoThumbService.js';

export const VIDEO_CATEGORIES = [
  'Dangal Highlights',
  'Championship Matches',
  'Training Sessions',
  'Dab Pach Techniques',
  'Traditional Kushti',
  'Fitness Training',
  'Coach Guidance',
  'Student Achievements',
  'Events',
  'Motivation',
];

const parseBool = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1' || value === 'Yes' || value === 'yes';
};

const parseOrder = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const parsePage = (value, fallback = 1) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

const parseLimit = (value, fallback = 12) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 100);
};

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

async function uniqueSlug(base, excludeId = null) {
  let slug = slugify(base) || `video-${Date.now()}`;
  let candidate = slug;
  let i = 1;
  while (true) {
    const existing = await prisma.video.findUnique({ where: { slug: candidate } });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${slug}-${i++}`;
  }
}

const idParam = [param('id').isUUID().withMessage('Invalid id')];
const slugParam = [param('slug').trim().notEmpty().withMessage('Slug is required')];

export const videoListValidation = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().trim(),
  query('category').optional().trim(),
  query('status').optional().isIn(['published', 'draft', 'all']),
];

export const videoCreateValidation = [
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }),
  body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 3000 }),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('subtitle').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  body('coachName').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('duration').optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body('displayOrder').optional(),
  body('isFeatured').optional(),
  body('status').optional().isIn(['published', 'draft']),
];

export const videoUpdateValidation = [
  ...idParam,
  body('title').optional().trim().notEmpty().withMessage('Title cannot be empty').isLength({ max: 200 }),
  body('description')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Description cannot be empty')
    .isLength({ max: 3000 }),
  body('category').optional().trim().notEmpty().withMessage('Category cannot be empty'),
  body('subtitle').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  body('coachName').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
  body('duration').optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body('displayOrder').optional(),
  body('isFeatured').optional(),
  body('status').optional().isIn(['published', 'draft']),
];

export const videoIdValidation = idParam;
export const videoSlugValidation = slugParam;

export const listVideosPublic = asyncHandler(async (req, res) => {
  const category = (req.query.category || '').trim();
  const where = {
    status: 'published',
    ...(category && { category }),
  };

  const [videos, featured] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.video.findFirst({
      where: { status: 'published', isFeatured: true },
      orderBy: [{ updatedAt: 'desc' }],
    }),
  ]);

  res.json({
    success: true,
    data: {
      videos: withIds(videos),
      featured: featured ? withId(featured) : null,
      categories: VIDEO_CATEGORIES,
    },
  });
});

export const getVideoBySlug = asyncHandler(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { slug: req.params.slug } });
  if (!video || video.status !== 'published') {
    throw new ApiError(404, 'Video not found');
  }

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: { views: { increment: 1 } },
  });

  res.json({ success: true, data: { video: withId(updated) } });
});

export const listVideosAdmin = asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page, 1);
  const limit = parseLimit(req.query.limit, 12);
  const search = (req.query.search || '').trim();
  const category = (req.query.category || '').trim();
  const status = req.query.status || 'all';

  const where = {
    ...(status !== 'all' && { status }),
    ...(category && { category }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { coachName: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [total, items] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      videos: withIds(items),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      categories: VIDEO_CATEGORIES,
    },
  });
});

export const getVideoStats = asyncHandler(async (_req, res) => {
  const [total, published, draft, featured, sizeAgg, recent] = await Promise.all([
    prisma.video.count(),
    prisma.video.count({ where: { status: 'published' } }),
    prisma.video.count({ where: { status: 'draft' } }),
    prisma.video.count({ where: { isFeatured: true } }),
    prisma.video.aggregate({ _sum: { fileSize: true } }),
    prisma.video.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, status: true, createdAt: true, thumbnail: true },
    }),
  ]);

  res.json({
    success: true,
    data: {
      totalVideos: total,
      publishedVideos: published,
      draftVideos: draft,
      featuredVideos: featured,
      totalStorageBytes: sizeAgg._sum.fileSize || 0,
      recentUploads: withIds(recent),
    },
  });
});

export const createVideo = asyncHandler(async (req, res) => {
  const videoUpload = req.file;
  const videoFile = videoUpload ? toPublicPath(videoUpload.filename, 'videos') : null;

  // Admin flow is file-upload only (no YouTube/Vimeo URL create)
  if (!videoFile) {
    throw new ApiError(400, 'Please upload an MP4 or WebM video file');
  }

  const youtubeUrl = null;
  const vimeoUrl = null;

  if (!VIDEO_CATEGORIES.includes((req.body.category || '').trim())) {
    deleteUploadedFile(videoFile);
    throw new ApiError(400, 'Invalid category');
  }

  let thumbnail = null;
  let duration = req.body.duration?.trim() || null;

  const abs = path.join(VIDEOS_DIR, videoUpload.filename);
  // Thumbnail/duration are best-effort — never fail the upload if ffmpeg is slow/unavailable
  try {
    thumbnail = await generateVideoThumbnail(abs);
  } catch (err) {
    console.warn('[videos] thumbnail failed:', err.message || err);
  }
  if (!duration) {
    try {
      duration = (await getVideoDurationLabel(abs)) || null;
    } catch (err) {
      console.warn('[videos] duration failed:', err.message || err);
    }
  }

  const slug = await uniqueSlug(req.body.title);
  const isFeatured = parseBool(req.body.isFeatured, false);

  if (isFeatured) {
    await prisma.video.updateMany({ data: { isFeatured: false }, where: { isFeatured: true } });
  }

  const video = await prisma.video.create({
    data: {
      title: req.body.title.trim(),
      slug,
      subtitle: req.body.subtitle?.trim() || null,
      description: req.body.description.trim(),
      category: req.body.category.trim(),
      coachName: req.body.coachName?.trim() || null,
      duration,
      thumbnail,
      videoFile,
      youtubeUrl,
      vimeoUrl,
      isFeatured,
      displayOrder: parseOrder(req.body.displayOrder, 0),
      status: req.body.status === 'published' ? 'published' : 'draft',
      fileSize: videoUpload.size || 0,
    },
  });

  res.status(201).json({ success: true, message: 'Video created', data: { video: withId(video) } });
});

export const updateVideo = asyncHandler(async (req, res) => {
  const existing = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Video not found');

  const videoUpload = req.file;

  let videoFile = existing.videoFile;
  let thumbnail = existing.thumbnail;
  let fileSize = existing.fileSize;
  let duration =
    req.body.duration !== undefined ? req.body.duration.trim() || null : existing.duration;

  if (videoUpload) {
    deleteUploadedFile(existing.videoFile);
    videoFile = toPublicPath(videoUpload.filename, 'videos');
    fileSize = videoUpload.size || 0;

    const abs = path.join(VIDEOS_DIR, videoUpload.filename);
    try {
      const generated = await generateVideoThumbnail(abs);
      if (generated) {
        deleteUploadedFile(existing.thumbnail);
        thumbnail = generated;
      }
    } catch (err) {
      console.warn('[videos] thumbnail failed:', err.message || err);
    }
    if (req.body.duration === undefined || !req.body.duration?.trim()) {
      try {
        duration = (await getVideoDurationLabel(abs)) || duration;
      } catch (err) {
        console.warn('[videos] duration failed:', err.message || err);
      }
    }
  }

  // Admin is file-upload only — do not accept new YouTube/Vimeo URLs from the form.
  // Legacy rows may still have URLs; keep them unless a new file replaces the source.
  const youtubeUrl = videoUpload ? null : existing.youtubeUrl;
  const vimeoUrl = videoUpload ? null : existing.vimeoUrl;

  if (!videoFile && !youtubeUrl && !vimeoUrl) {
    throw new ApiError(400, 'Please upload an MP4 or WebM video file');
  }

  if (req.body.category && !VIDEO_CATEGORIES.includes(req.body.category.trim())) {
    throw new ApiError(400, 'Invalid category');
  }

  const title = req.body.title !== undefined ? req.body.title.trim() : existing.title;
  const slug =
    req.body.title !== undefined ? await uniqueSlug(title, existing.id) : existing.slug;

  const isFeatured =
    req.body.isFeatured !== undefined ? parseBool(req.body.isFeatured, false) : existing.isFeatured;

  if (isFeatured && !existing.isFeatured) {
    await prisma.video.updateMany({
      where: { isFeatured: true, NOT: { id: existing.id } },
      data: { isFeatured: false },
    });
  }

  const video = await prisma.video.update({
    where: { id: req.params.id },
    data: {
      title,
      slug,
      ...(req.body.subtitle !== undefined && { subtitle: req.body.subtitle.trim() || null }),
      ...(req.body.description !== undefined && { description: req.body.description.trim() }),
      ...(req.body.category !== undefined && { category: req.body.category.trim() }),
      ...(req.body.coachName !== undefined && { coachName: req.body.coachName.trim() || null }),
      duration,
      youtubeUrl,
      vimeoUrl,
      thumbnail,
      videoFile,
      fileSize,
      isFeatured,
      ...(req.body.displayOrder !== undefined && { displayOrder: parseOrder(req.body.displayOrder) }),
      ...(req.body.status !== undefined && {
        status: req.body.status === 'published' ? 'published' : 'draft',
      }),
    },
  });

  res.json({ success: true, message: 'Video updated', data: { video: withId(video) } });
});

export const deleteVideo = asyncHandler(async (req, res) => {
  const existing = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Video not found');

  await prisma.video.delete({ where: { id: req.params.id } });
  deleteUploadedFile(existing.videoFile);
  deleteUploadedFile(existing.thumbnail);

  res.json({ success: true, message: 'Video deleted' });
});

/** Directory size helper for dashboard (optional accuracy) */
export function getUploadsVideoStorageBytes() {
  try {
    const dir = path.join(UPLOADS_DIR, 'videos');
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).reduce((sum, name) => {
      try {
        return sum + fs.statSync(path.join(dir, name)).size;
      } catch {
        return sum;
      }
    }, 0);
  } catch {
    return 0;
  }
}
