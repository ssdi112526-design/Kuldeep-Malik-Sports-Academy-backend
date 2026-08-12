import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from '@ffprobe-installer/ffprobe';
import { THUMBS_DIR, UPLOADS_DIR, toPublicPath } from '../middleware/upload.js';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath?.path) ffmpeg.setFfprobePath(ffprobePath.path);

const FFMPEG_TIMEOUT_MS = Number(process.env.VIDEO_THUMB_TIMEOUT_MS || 20_000);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function runFfmpegSeek(inputPath, outputPath, seekSeconds) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .inputOptions([`-ss ${seekSeconds}`])
      .outputOptions(['-frames:v 1', '-q:v 2'])
      .output(outputPath)
      .on('end', () => resolve(true))
      .on('error', (err) => reject(err));

    command.run();
  });
}

function probeDuration(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return resolve(null);
      const seconds = Number(data?.format?.duration);
      resolve(Number.isFinite(seconds) ? seconds : null);
    });
  });
}

export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function absoluteFromPublic(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  return path.join(UPLOADS_DIR, publicPath.replace(/^\/uploads\//, ''));
}

/**
 * Extract a JPEG thumbnail from a local video file.
 * Tries ~1.5s first, then falls back to the first frame.
 * Hard-timeouts so hung ffmpeg cannot kill the HTTP upload request.
 */
export async function generateVideoThumbnail(absoluteVideoPath) {
  if (!absoluteVideoPath || !fs.existsSync(absoluteVideoPath)) return null;
  if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const filename = `thumb-${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
  const outputPath = path.join(THUMBS_DIR, filename);

  const finish = async () => {
    const publicPath = toPublicPath(filename, 'thumbnails');
    try {
      const { rememberUploadPath } = await import('../utils/mediaBlobStore.js');
      await rememberUploadPath(outputPath, 'image/jpeg');
    } catch {
      /* ignore persist errors */
    }
    return publicPath;
  };

  try {
    await withTimeout(
      runFfmpegSeek(absoluteVideoPath, outputPath, 1.5),
      FFMPEG_TIMEOUT_MS,
      'ffmpeg thumb seek'
    );
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      return finish();
    }
  } catch (err) {
    console.warn('[video-thumb]', err.message || err);
  }

  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    await withTimeout(
      runFfmpegSeek(absoluteVideoPath, outputPath, 0),
      FFMPEG_TIMEOUT_MS,
      'ffmpeg thumb frame0'
    );
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      return finish();
    }
  } catch (err) {
    console.warn('[video-thumb]', err.message || err);
  }

  if (fs.existsSync(outputPath)) {
    try {
      fs.unlinkSync(outputPath);
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function getVideoDurationLabel(absoluteVideoPath) {
  try {
    const seconds = await withTimeout(
      probeDuration(absoluteVideoPath),
      FFMPEG_TIMEOUT_MS,
      'ffprobe duration'
    );
    return formatDuration(seconds);
  } catch (err) {
    console.warn('[video-duration]', err.message || err);
    return null;
  }
}
