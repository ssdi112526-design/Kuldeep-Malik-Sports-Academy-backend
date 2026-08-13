import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import ApiError from '../utils/ApiError.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
export const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
export const THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbnails');
export const ENTRY_DIR = path.join(UPLOADS_DIR, 'entry');
export const ENTRY_PHOTOS_DIR = path.join(ENTRY_DIR, 'photos');
export const ENTRY_DOCS_DIR = path.join(ENTRY_DIR, 'documents');
export const COACH_CERTS_DIR = path.join(ENTRY_DIR, 'coach-certificates');
export const ENTRY_EQUIPMENT_DIR = path.join(ENTRY_DIR, 'equipment');
export const SPONSORSHIP_DOCS_DIR = path.join(ENTRY_DIR, 'sponsorships');
export const QR_DIR = path.join(UPLOADS_DIR, 'qr');

[
  UPLOADS_DIR,
  VIDEOS_DIR,
  THUMBS_DIR,
  ENTRY_DIR,
  ENTRY_PHOTOS_DIR,
  ENTRY_DOCS_DIR,
  COACH_CERTS_DIR,
  ENTRY_EQUIPMENT_DIR,
  SPONSORSHIP_DOCS_DIR,
  QR_DIR,
].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm']);
const PDF_MIME = new Set(['application/pdf']);
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 500 * 1024 * 1024;

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const mediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEOS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.mp4', '.webm'].includes(ext) ? ext : '.mp4';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

function imageFilter(_req, file, cb) {
  if (!IMAGE_MIME.has(file.mimetype)) {
    return cb(new ApiError(400, 'Only JPG, JPEG, PNG, and WEBP images are allowed'));
  }
  cb(null, true);
}

function mediaFilter(_req, file, cb) {
  if (file.fieldname === 'video') {
    if (!VIDEO_MIME.has(file.mimetype) && !/\.(mp4|webm)$/i.test(file.originalname)) {
      return cb(new ApiError(400, 'Only MP4 and WebM videos are allowed'));
    }
    return cb(null, true);
  }
  return cb(new ApiError(400, 'Unexpected upload field'));
}

const imageFieldsUpload = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: MAX_IMAGE },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'photo', maxCount: 1 },
  { name: 'file', maxCount: 1 },
]);

/** Accept image|photo|file and normalize onto req.file (legacy .single('image') compatible). */
export const uploadSingle = (req, res, next) => {
  imageFieldsUpload(req, res, (err) => {
    if (err) return next(err);
    const bag = req.files || {};
    const picked = bag.image?.[0] || bag.photo?.[0] || bag.file?.[0] || null;
    if (picked) req.file = picked;
    next();
  });
};

/** Profile photo for user management (field: profileImage) */
export const uploadProfileImage = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: MAX_IMAGE },
}).single('profileImage');

export const uploadMultiple = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: MAX_IMAGE, files: 20 },
}).array('images', 20);

export const uploadVideoMedia = multer({
  storage: mediaStorage,
  fileFilter: mediaFilter,
  limits: { fileSize: MAX_VIDEO },
}).single('video');

/** Website site-settings images (hero + about) */
export const uploadSiteSettings = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: MAX_IMAGE },
}).fields([
  { name: 'heroImage', maxCount: 1 },
  { name: 'aboutImage', maxCount: 1 },
]);

// ---------------------------
// Entry Management uploads
// ---------------------------

const entryStorage = multer.diskStorage({
  destination: (_req, file, cb) => {
    if (file.fieldname === 'image') return cb(null, ENTRY_EQUIPMENT_DIR);
    if (file.fieldname === 'certificates') return cb(null, COACH_CERTS_DIR);
    if (file.fieldname === 'photo' || file.fieldname === 'parentPhoto') return cb(null, ENTRY_PHOTOS_DIR);
    // aadhaarFront / aadhaarBack / panCard etc
    return cb(null, ENTRY_DOCS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeImageExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const safePdfExts = ['.pdf'];

    let safeExt = ext;
    if (file.fieldname === 'certificates') {
      safeExt = safePdfExts.includes(ext) ? ext : safeImageExts.includes(ext) ? ext : '.pdf';
    } else {
      safeExt = safeImageExts.includes(ext) ? ext : '.jpg';
    }

    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

function entryFileFilter(_req, file, cb) {
  // Certificates can be images or PDFs
  if (file.fieldname === 'certificates') {
    if (IMAGE_MIME.has(file.mimetype) || PDF_MIME.has(file.mimetype)) return cb(null, true);
    return cb(new ApiError(400, 'Certificates must be images (JPG/PNG/WEBP) or PDF'));
  }

  // Everything else in Entry Management is image-based
  if (IMAGE_MIME.has(file.mimetype)) return cb(null, true);
  return cb(new ApiError(400, 'Only images (JPG/PNG/WEBP) are allowed for this field'));
}

const uploadEntryBase = multer({
  storage: entryStorage,
  fileFilter: entryFileFilter,
  limits: { fileSize: MAX_IMAGE }, // 10MB max as per requirement
});

// Student
export const uploadStudentEntry = uploadEntryBase.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'parentPhoto', maxCount: 1 },
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
]);

// Coach
export const uploadCoachEntry = uploadEntryBase.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
  { name: 'certificates', maxCount: 10 },
]);

// Equipment / Tools image
export const uploadEquipmentEntry = uploadEntryBase.single('image');

const sponsorshipStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SPONSORSHIP_DOCS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx'].includes(ext)
      ? ext
      : '.pdf';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

function sponsorshipFileFilter(_req, file, cb) {
  const allowed =
    IMAGE_MIME.has(file.mimetype) ||
    PDF_MIME.has(file.mimetype) ||
    file.mimetype === 'application/msword' ||
    file.mimetype ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.(pdf|jpe?g|png|webp|docx?)$/i.test(file.originalname);
  if (!allowed) {
    return cb(new ApiError(400, 'Sponsorship documents must be PDF, Word, or image'));
  }
  cb(null, true);
}

export const uploadSponsorshipDoc = multer({
  storage: sponsorshipStorage,
  fileFilter: sponsorshipFileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
}).single('document');

export function toPublicPath(filenameOrPath, subfolder = '') {
  if (!filenameOrPath) return null;
  if (filenameOrPath.startsWith('http') || filenameOrPath.startsWith('/uploads/')) {
    return filenameOrPath;
  }
  const prefix = subfolder ? `/uploads/${subfolder}/` : '/uploads/';
  return `${prefix}${filenameOrPath.replace(/^\/+/, '')}`;
}

export function deleteUploadedFile(filePath) {
  if (!filePath || !filePath.includes('/uploads/')) return;
  const relative = filePath.replace(/^\/uploads\//, '');
  const full = path.join(UPLOADS_DIR, relative);
  if (fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
      console.log(`[uploads] deleted disk file: ${relative}`);
    } catch {
      /* ignore */
    }
  }
  // Drop Postgres backup only when no other live record still references the path
  import('../utils/mediaBlobStore.js')
    .then(({ forgetUploadPathIfUnreferenced }) => forgetUploadPathIfUnreferenced(filePath))
    .catch(() => {});
}

/**
 * Wrap a multer uploader so successful files are also backed up to Postgres mediaBlobStore.
 */
export function withMediaBlobBackup(uploader) {
  return (req, res, next) => {
    uploader(req, res, async (err) => {
      if (err) return handleMulterError(err, req, res, next);
      try {
        const { rememberMulterUploads } = await import('../utils/mediaBlobStore.js');
        await rememberMulterUploads(req);
      } catch (persistErr) {
        console.error('[media-blob] persist after upload failed:', persistErr.message);
      }
      next();
    });
  };
}

export function handleMulterError(err, _req, _res, next) {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new ApiError(400, 'File exceeds size limit (images 10MB, videos 500MB)'));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new ApiError(400, 'Too many files uploaded'));
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(
        new ApiError(
          400,
          `Unexpected upload field "${err.field || 'unknown'}". Use field name "image" (or photo/file).`
        )
      );
    }
    return next(new ApiError(400, err.message));
  }
  return next(err);
}
