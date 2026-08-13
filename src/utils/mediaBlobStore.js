/**
 * Persist uploaded files into Postgres so Render redeploys don't wipe CMS media.
 * Disk (/uploads) remains the fast runtime source; DB is durable backup + recovery.
 */
import fs from 'fs';
import path from 'path';
import prisma from '../config/db.js';
import { UPLOADS_DIR } from '../middleware/upload.js';

const MAX_BLOB_BYTES = Number(process.env.MEDIA_BLOB_MAX_BYTES || 60 * 1024 * 1024);

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
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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

function addPath(set, value) {
  const relative = toUploadsRelative(value);
  if (relative) set.add(relative);
}

function walkJsonForUploadPaths(value, set) {
  if (!value) return;
  if (typeof value === 'string') {
    if (value.includes('/uploads/') || value.startsWith('uploads/')) addPath(set, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkJsonForUploadPaths(item, set);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) walkJsonForUploadPaths(item, set);
  }
}

/** Collect /uploads paths referenced by live application records (not the blob table). */
export async function collectReferencedUploadPaths() {
  const paths = new Set();

  const safe = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      console.warn(`[media-blob] reference scan skipped (${label}):`, err.message);
    }
  };

  await Promise.all([
    safe('gallery', async () => {
      const rows = await prisma.galleryItem.findMany({ select: { image: true } });
      rows.forEach((r) => addPath(paths, r.image));
    }),
    safe('athletes', async () => {
      const rows = await prisma.athlete.findMany({ select: { image: true } });
      rows.forEach((r) => addPath(paths, r.image));
    }),
    safe('programs', async () => {
      const rows = await prisma.program.findMany({ select: { image: true } });
      rows.forEach((r) => addPath(paths, r.image));
    }),
    safe('facilities', async () => {
      const rows = await prisma.facility.findMany({ select: { image: true } });
      rows.forEach((r) => addPath(paths, r.image));
    }),
    safe('features', async () => {
      const rows = await prisma.feature.findMany({ select: { image: true } });
      rows.forEach((r) => addPath(paths, r.image));
    }),
    safe('membership', async () => {
      const rows = await prisma.membershipPlan.findMany({ select: { image: true } });
      rows.forEach((r) => addPath(paths, r.image));
    }),
    safe('equipment', async () => {
      const rows = await prisma.equipment.findMany({ select: { image: true, qrCodePath: true } });
      rows.forEach((r) => {
        addPath(paths, r.image);
        addPath(paths, r.qrCodePath);
      });
    }),
    safe('students', async () => {
      const rows = await prisma.student.findMany({
        select: { photo: true, parentPhoto: true, qrCodePath: true },
      });
      rows.forEach((r) => {
        addPath(paths, r.photo);
        addPath(paths, r.parentPhoto);
        addPath(paths, r.qrCodePath);
      });
    }),
    safe('studentDocs', async () => {
      const rows = await prisma.studentDocument.findMany({
        select: { aadhaarFrontImage: true, aadhaarBackImage: true, panCardImage: true },
      });
      rows.forEach((r) => {
        addPath(paths, r.aadhaarFrontImage);
        addPath(paths, r.aadhaarBackImage);
        addPath(paths, r.panCardImage);
      });
    }),
    safe('coaches', async () => {
      const rows = await prisma.coach.findMany({ select: { photo: true, qrCodePath: true } });
      rows.forEach((r) => {
        addPath(paths, r.photo);
        addPath(paths, r.qrCodePath);
      });
    }),
    safe('coachDocs', async () => {
      const rows = await prisma.coachDocument.findMany({
        select: {
          aadhaarFrontImage: true,
          aadhaarBackImage: true,
          panCardImage: true,
          certificates: true,
        },
      });
      rows.forEach((r) => {
        addPath(paths, r.aadhaarFrontImage);
        addPath(paths, r.aadhaarBackImage);
        addPath(paths, r.panCardImage);
        walkJsonForUploadPaths(r.certificates, paths);
      });
    }),
    safe('achievements', async () => {
      const rows = await prisma.playerAchievement.findMany({ select: { image: true } });
      rows.forEach((r) => addPath(paths, r.image));
    }),
    safe('tournaments', async () => {
      const rows = await prisma.tournament.findMany({ select: { image: true } });
      rows.forEach((r) => addPath(paths, r.image));
    }),
    safe('tournamentResults', async () => {
      const rows = await prisma.tournamentResult.findMany({ select: { image: true } });
      rows.forEach((r) => addPath(paths, r.image));
    }),
    safe('sponsorships', async () => {
      const rows = await prisma.sponsorship.findMany({
        where: { deletedAt: null },
        select: { documentPath: true },
      });
      rows.forEach((r) => addPath(paths, r.documentPath));
    }),
    safe('parents', async () => {
      const rows = await prisma.parentProfile.findMany({ select: { photo: true } });
      rows.forEach((r) => addPath(paths, r.photo));
    }),
    safe('users', async () => {
      const rows = await prisma.user.findMany({ select: { profileImage: true } });
      rows.forEach((r) => addPath(paths, r.profileImage));
    }),
    safe('videos', async () => {
      const rows = await prisma.video.findMany({ select: { thumbnail: true, videoFile: true } });
      rows.forEach((r) => {
        addPath(paths, r.thumbnail);
        addPath(paths, r.videoFile);
      });
    }),
    safe('siteSettings', async () => {
      const rows = await prisma.siteSetting.findMany({ select: { value: true } });
      rows.forEach((r) => walkJsonForUploadPaths(r.value, paths));
    }),
  ]);

  return paths;
}

/** Fast check whether any live record still points at this /uploads path. */
export async function isUploadPathReferenced(absoluteOrPublicPath) {
  const relative = toUploadsRelative(absoluteOrPublicPath);
  if (!relative) return false;
  const publicPath = `/uploads/${relative}`;
  const variants = [publicPath, relative, `uploads/${relative}`];
  const or = (field) => variants.map((v) => ({ [field]: v }));

  try {
    const hits = await Promise.all([
      prisma.galleryItem.findFirst({ where: { OR: or('image') }, select: { id: true } }),
      prisma.athlete.findFirst({ where: { OR: or('image') }, select: { id: true } }),
      prisma.program.findFirst({ where: { OR: or('image') }, select: { id: true } }),
      prisma.facility.findFirst({ where: { OR: or('image') }, select: { id: true } }),
      prisma.feature.findFirst({ where: { OR: or('image') }, select: { id: true } }),
      prisma.membershipPlan.findFirst({ where: { OR: or('image') }, select: { id: true } }),
      prisma.equipment.findFirst({
        where: { OR: [...or('image'), ...or('qrCodePath')] },
        select: { id: true },
      }),
      prisma.student.findFirst({
        where: { OR: [...or('photo'), ...or('parentPhoto'), ...or('qrCodePath')] },
        select: { id: true },
      }),
      prisma.studentDocument.findFirst({
        where: {
          OR: [...or('aadhaarFrontImage'), ...or('aadhaarBackImage'), ...or('panCardImage')],
        },
        select: { id: true },
      }),
      prisma.coach.findFirst({
        where: { OR: [...or('photo'), ...or('qrCodePath')] },
        select: { id: true },
      }),
      prisma.coachDocument.findFirst({
        where: {
          OR: [...or('aadhaarFrontImage'), ...or('aadhaarBackImage'), ...or('panCardImage')],
        },
        select: { id: true },
      }),
      prisma.playerAchievement.findFirst({ where: { OR: or('image') }, select: { id: true } }),
      prisma.tournament.findFirst({ where: { OR: or('image') }, select: { id: true } }),
      prisma.tournamentResult.findFirst({ where: { OR: or('image') }, select: { id: true } }),
      prisma.sponsorship.findFirst({
        where: { deletedAt: null, OR: or('documentPath') },
        select: { id: true },
      }),
      prisma.parentProfile.findFirst({ where: { OR: or('photo') }, select: { id: true } }),
      prisma.user.findFirst({ where: { OR: or('profileImage') }, select: { id: true } }),
      prisma.video.findFirst({
        where: { OR: [...or('thumbnail'), ...or('videoFile')] },
        select: { id: true },
      }),
    ]);
    return hits.some(Boolean);
  } catch (err) {
    console.warn('[media-blob] reference check failed:', err.message);
    return false;
  }
}

export async function rememberUploadPath(absoluteOrPublicPath, mimeType) {
  try {
    const relative = toUploadsRelative(absoluteOrPublicPath);
    if (!relative) return false;
    const absolute = path.join(UPLOADS_DIR, relative);
    if (!fs.existsSync(absolute)) {
      console.error(`[media-blob] backup skipped — disk file missing: ${relative}`);
      return false;
    }

    const stat = fs.statSync(absolute);
    if (stat.size <= 0) {
      console.error(`[media-blob] backup skipped — empty file: ${relative}`);
      return false;
    }
    const mime = mimeType || mimeFromExt(absolute);
    if (stat.size > MAX_BLOB_BYTES) {
      console.error(
        `[media-blob] backup skipped ${relative} (${Math.round(stat.size / (1024 * 1024))}MB > ${Math.round(MAX_BLOB_BYTES / (1024 * 1024))}MB limit)`
      );
      return false;
    }

    const data = fs.readFileSync(absolute);
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
    console.log(`[media-blob] backup OK: ${relative} (${stat.size} bytes)`);
    return true;
  } catch (err) {
    console.error('[media-blob] backup failed:', err.message);
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

  let saved = 0;
  let failed = 0;
  let skippedVideo = 0;

  for (const file of files) {
    if (!file?.path && !file?.filename) continue;
    const absolute = file.path || path.join(UPLOADS_DIR, file.filename);
    // Persist videos after the HTTP response in videoController to avoid upload timeouts.
    if (String(file.mimetype || '').startsWith('video/')) {
      skippedVideo += 1;
      continue;
    }
    const ok = await rememberUploadPath(absolute, file.mimetype);
    if (ok) saved += 1;
    else failed += 1;
  }

  if (failed > 0) {
    console.error(`[media-blob] upload batch: ${saved} backed up, ${failed} failed, ${skippedVideo} video(s) deferred`);
  } else if (saved > 0) {
    console.log(`[media-blob] upload batch: ${saved} backed up${skippedVideo ? `, ${skippedVideo} video(s) deferred` : ''}`);
  }

  return { saved, failed, skippedVideo };
}

/** Fire-and-forget durable backup (safe after response is sent). */
export function scheduleRememberUpload(absoluteOrPublicPath, mimeType) {
  setImmediate(() => {
    rememberUploadPath(absoluteOrPublicPath, mimeType).catch((err) => {
      console.error('[media-blob] scheduled backup failed:', err.message);
    });
  });
}

export function uploadsFileExists(publicPath) {
  const relative = toUploadsRelative(publicPath);
  if (!relative) return false;
  return fs.existsSync(path.join(UPLOADS_DIR, relative));
}

export async function forgetUploadPath(absoluteOrPublicPath) {
  try {
    const relative = toUploadsRelative(absoluteOrPublicPath);
    if (!relative) return;
    const result = await prisma.mediaBlob.deleteMany({ where: { relativePath: relative } });
    if (result.count > 0) {
      console.log(`[media-blob] deleted backup: ${relative}`);
    }
  } catch (err) {
    console.error('[media-blob] delete backup failed:', err.message);
  }
}

/** Delete Postgres backup only when no live record still references the path. */
export async function forgetUploadPathIfUnreferenced(absoluteOrPublicPath) {
  const relative = toUploadsRelative(absoluteOrPublicPath);
  if (!relative) return;
  try {
    if (await isUploadPathReferenced(relative)) {
      console.log(`[media-blob] keep shared backup: ${relative}`);
      return;
    }
    await forgetUploadPath(relative);
  } catch (err) {
    console.error('[media-blob] unreferenced delete check failed:', err.message);
  }
}

/** Restore a single missing disk file from Postgres BYTEA. */
export async function restoreFileFromDb(absoluteOrPublicPath) {
  const relative = toUploadsRelative(absoluteOrPublicPath);
  if (!relative) return false;

  const dest = path.join(UPLOADS_DIR, relative);
  if (fs.existsSync(dest)) return true;

  if (typeof prisma.mediaBlob?.findUnique !== 'function') {
    console.warn('[media-blob] model missing — run prisma db push / generate');
    return false;
  }

  const row = await prisma.mediaBlob.findUnique({
    where: { relativePath: relative },
    select: { data: true, mimeType: true, byteSize: true },
  });
  if (!row?.data) {
    console.warn(`[media-blob] no Postgres backup for missing file: ${relative}`);
    return false;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(row.data));
  console.log(`[media-blob] restored: ${relative} (${row.byteSize || 0} bytes, ${row.mimeType || 'unknown'})`);
  return true;
}

/**
 * Restore missing /uploads files from Postgres.
 * Default: only paths referenced by active records (avoids dumping unused blobs).
 * mode 'all': restore any blob row whose disk file is missing.
 */
export async function restoreMissingMedia({ onlyReferenced = true } = {}) {
  if (typeof prisma.mediaBlob?.findMany !== 'function') {
    console.warn('[media-blob] model missing — run prisma db push / generate');
    return {
      checked: 0,
      alreadyAvailable: 0,
      restored: 0,
      failed: 0,
      skipped: 0,
      total: 0,
    };
  }

  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  console.log(`[media-blob] restore started (onlyReferenced=${onlyReferenced})`);

  let candidates;
  if (onlyReferenced) {
    candidates = [...(await collectReferencedUploadPaths())];
  } else {
    const rows = await prisma.mediaBlob.findMany({ select: { relativePath: true } });
    candidates = rows.map((r) => r.relativePath);
  }

  let restored = 0;
  let alreadyAvailable = 0;
  let failed = 0;

  for (const relative of candidates) {
    const dest = path.join(UPLOADS_DIR, relative);
    if (fs.existsSync(dest)) {
      alreadyAvailable += 1;
      continue;
    }
    try {
      const ok = await restoreFileFromDb(relative);
      if (ok) restored += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`[media-blob] restore failed for ${relative}:`, err.message);
    }
  }

  const summary = {
    checked: candidates.length,
    alreadyAvailable,
    restored,
    failed,
    skipped: alreadyAvailable,
    total: candidates.length,
  };

  console.log(
    `[media-blob] restore completed — checked=${summary.checked} available=${summary.alreadyAvailable} restored=${summary.restored} failed=${summary.failed}`
  );

  return summary;
}

/** @deprecated Prefer restoreMissingMedia — kept for server.js compatibility */
export async function restoreMediaBlobsFromDb() {
  return restoreMissingMedia({ onlyReferenced: true });
}

/** Non-blocking restore after API is listening. */
export function startBackgroundMediaRestore(options = {}) {
  setImmediate(() => {
    restoreMissingMedia(options).catch((err) => {
      console.error('[media-blob] background restore failed:', err.message);
    });
  });
}

export async function getMediaRestoreStatus() {
  const referenced = await collectReferencedUploadPaths();
  let blobCount = 0;
  try {
    blobCount = await prisma.mediaBlob.count();
  } catch {
    blobCount = 0;
  }

  let missingOnDisk = 0;
  let availableOnDisk = 0;
  for (const relative of referenced) {
    if (fs.existsSync(path.join(UPLOADS_DIR, relative))) availableOnDisk += 1;
    else missingOnDisk += 1;
  }

  return {
    referencedCount: referenced.size,
    blobCount,
    availableOnDisk,
    missingOnDisk,
  };
}
