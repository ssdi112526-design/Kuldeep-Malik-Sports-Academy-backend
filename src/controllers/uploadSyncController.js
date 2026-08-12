import fs from 'fs';
import path from 'path';
import multer from 'multer';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { UPLOADS_DIR, handleMulterError } from '../middleware/upload.js';
import { rememberUploadPath } from '../utils/mediaBlobStore.js';

const tmpDir = path.join(UPLOADS_DIR, '.sync-tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const syncStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

export const uploadSyncFile = multer({
  storage: syncStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
}).single('file');

function resolveSafeUploadPath(relativePath) {
  const cleaned = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads\//i, '');

  if (!cleaned || cleaned.includes('..')) {
    throw new ApiError(400, 'Invalid relativePath');
  }

  const absolute = path.resolve(UPLOADS_DIR, cleaned);
  const root = path.resolve(UPLOADS_DIR);
  if (!absolute.startsWith(root + path.sep) && absolute !== root) {
    throw new ApiError(400, 'Invalid upload path');
  }
  return { cleaned, absolute };
}

export const syncUploadFile = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'file is required');

  const relativePath = req.body.relativePath || req.body.path;
  const { cleaned, absolute } = resolveSafeUploadPath(relativePath);

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
  fs.renameSync(req.file.path, absolute);
  await rememberUploadPath(absolute, req.file.mimetype);

  res.json({
    success: true,
    message: 'File synced',
    data: {
      relativePath: cleaned,
      publicPath: `/uploads/${cleaned.replace(/\\/g, '/')}`,
      size: req.file.size,
    },
  });
});

export const runSyncUpload = (req, res, next) => {
  uploadSyncFile(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
  });
};
