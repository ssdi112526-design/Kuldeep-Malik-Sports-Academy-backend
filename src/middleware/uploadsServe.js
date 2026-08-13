/**
 * /uploads serving helpers:
 * - Block private document folders from public static access
 * - On-demand restore from Postgres when disk file is missing (Render wipe)
 */
import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR } from './upload.js';
import { restoreFileFromDb, toUploadsRelative } from '../utils/mediaBlobStore.js';

/** Folders that must never be served via public /uploads static routes. */
const PRIVATE_UPLOAD_PREFIXES = ['entry/sponsorships'];

export function isPrivateUploadPath(reqPath) {
  const cleaned = String(reqPath || '')
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  return PRIVATE_UPLOAD_PREFIXES.some(
    (folder) => cleaned === folder || cleaned.startsWith(`${folder}/`)
  );
}

/** Reject unauthenticated/public static access to private documents. */
export function blockPrivateUploads(req, res, next) {
  if (!isPrivateUploadPath(req.path)) return next();
  return res.status(403).json({
    success: false,
    message: 'Private document. Use the authenticated download API.',
  });
}

/**
 * If a requested /uploads file is missing on disk, restore it from mediaBlobStore
 * then let express.static serve it. Does not read BYTEA on normal (file present) requests.
 */
export async function restoreMissingUploadOnDemand(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const relative = toUploadsRelative(`/uploads/${String(req.path || '').replace(/^\/+/, '')}`);
  if (!relative || isPrivateUploadPath(relative)) return next();

  const absolute = path.join(UPLOADS_DIR, relative);
  if (fs.existsSync(absolute)) return next();

  try {
    await restoreFileFromDb(relative);
  } catch (err) {
    console.warn(`[media-blob] on-demand restore failed for ${relative}:`, err.message);
  }
  return next();
}
