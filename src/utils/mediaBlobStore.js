/**
 * Persist uploaded files into Postgres so Render redeploys don't wipe CMS media.
 * Disk remains the runtime source; DB is the durable backup restored on boot.
 */
import fs from 'fs';
import path from 'path';
import prisma from '../config/db.js';
import { UPLOADS_DIR } from '../middleware/upload.js';

const MAX_BLOB_BYTES = Number(process.env.MEDIA_BLOB_MAX_BYTES || 40 * 1024 * 1024);

function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

export function toUploadsRelative(absoluteOrPublicPath) {
  if (!absoluteOrPublicPath) return null;
  let cleaned = String(absoluteOrPublicPath).replace(/\\/g, '/');
  if (cleaned.startsWith('/uploads/')) cleaned = cleaned.slice('/uploads/'.length);
  else if (path.isAbsolute(absoluteOrPublicPath)) {
    cleaned = path.relative(UPLOADS_DIR, absoluteOrPublicPath).replace(/\\/g, '/');
  }
  cleaned = cleaned.replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..')) return null;
  return cleaned;
}

export async function rememberUploadPath(absoluteOrPublicPath, mimeType) {
  try {
    const relative = toUploadsRelative(absoluteOrPublicPath);
    if (!relative) return false;
    const absolute = path.join(UPLOADS_DIR, relative);
    if (!fs.existsSync(absolute)) return false;

    const stat = fs.statSync(absolute);
    if (stat.size <= 0) return false;
    if (stat.size > MAX_BLOB_BYTES) {
      console.warn(
        `[media-blob] skip ${relative} (${Math.round(stat.size / (1024 * 1024))}MB > limit)`
      );
      return false;
    }

    const data = fs.readFileSync(absolute);
    const mime = mimeType || mimeFromExt(absolute);
    await prisma.mediaBlob.upsert({
      where: { relativePath: relative },
      create: {
        relativePath: relative,
        mimeType: mime,
        byteSize: stat.size,
        data,
      },
      update: {
        mimeType: mime,
        byteSize: stat.size,
        data,
      },
    });
    return true;
  } catch (err) {
    console.warn('[media-blob] remember failed:', err.message);
    return false;
  }
}

export async function rememberMulterUploads(req) {
  const files = [];
  if (req?.file) files.push(req.file);
  if (Array.isArray(req?.files)) files.push(...req.files);
  else if (req?.files && typeof req.files === 'object') {
    for (const value of Object.values(req.files)) {
      if (Array.isArray(value)) files.push(...value);
      else if (value) files.push(value);
    }
  }

  for (const file of files) {
    if (!file?.path && !file?.filename) continue;
    const absolute = file.path || path.join(UPLOADS_DIR, file.filename);
    await rememberUploadPath(absolute, file.mimetype);
  }
}

export async function forgetUploadPath(absoluteOrPublicPath) {
  try {
    const relative = toUploadsRelative(absoluteOrPublicPath);
    if (!relative) return;
    await prisma.mediaBlob.deleteMany({ where: { relativePath: relative } });
  } catch (err) {
    console.warn('[media-blob] forget failed:', err.message);
  }
}

export async function restoreMediaBlobsFromDb() {
  if (typeof prisma.mediaBlob?.findMany !== 'function') {
    console.warn('[media-blob] model missing — run prisma db push / generate');
    return { restored: 0, skipped: 0, total: 0 };
  }

  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const rows = await prisma.mediaBlob.findMany({
    select: { relativePath: true, data: true },
  });

  let restored = 0;
  let skipped = 0;

  for (const row of rows) {
    const dest = path.join(UPLOADS_DIR, row.relativePath);
    if (fs.existsSync(dest)) {
      skipped += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(row.data));
    restored += 1;
  }

  if (restored > 0) {
    console.log(`[media-blob] Restored ${restored} file(s) from Postgres (${skipped} already on disk)`);
  } else {
    console.log(`[media-blob] Postgres backup check OK — ${skipped} file(s) already on disk`);
  }

  return { restored, skipped, total: rows.length };
}
