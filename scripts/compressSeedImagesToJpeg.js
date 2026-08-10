/**
 * Recompress CMS seed images to efficient JPEG and update DB paths (.png → .jpg).
 * Run from repo: node server/scripts/compressSeedImagesToJpeg.js
 * Uses sharp from client/node_modules.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/package.json'));
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(__dirname, '../uploads');
const SEED = path.resolve(__dirname, '../seed-media');
const CLIENT = path.resolve(__dirname, '../../client/src/assets/akhada');

const FILES = [
  'programs-beginner',
  'programs-strength-hd',
  'programs-strength',
  'programs-mud-hd',
  'programs-advanced',
  'facilities-mud',
  'facilities-nutrition',
  'facilities-recovery',
  'gallery-action-1',
  'gallery-action-2',
  'gallery-competition',
  'gallery-mitti',
  'gallery-yoga',
  'gallery-recovery',
];

const prisma = new PrismaClient();

async function toJpeg(srcPng, destJpg, width = 1200) {
  await sharp(srcPng)
    .rotate()
    .resize({ width, height: Math.round(width * 0.75), fit: 'cover', position: 'attention' })
    .jpeg({ quality: 78, mozjpeg: true, progressive: true })
    .toFile(destJpg);
}

async function main() {
  for (const base of FILES) {
    const src = path.join(CLIENT, `${base}.png`);
    if (!fs.existsSync(src)) {
      console.warn('skip missing', base);
      continue;
    }
    const jpgName = `seed-${base}.jpg`;
    const destUpload = path.join(UPLOADS, jpgName);
    const destSeed = path.join(SEED, jpgName);
    await toJpeg(src, destUpload);
    fs.copyFileSync(destUpload, destSeed);
    console.log('OK', jpgName, `${Math.round(fs.statSync(destUpload).size / 1024)}KB`);
  }

  const replaceExt = (img) =>
    typeof img === 'string' && img.includes('/uploads/seed-') && img.endsWith('.png')
      ? img.replace(/\.png$/i, '.jpg')
      : null;

  for (const row of await prisma.program.findMany()) {
    const next = replaceExt(row.image);
    if (next) {
      await prisma.program.update({ where: { id: row.id }, data: { image: next } });
      console.log('program', row.title, '→', next);
    }
  }
  for (const row of await prisma.facility.findMany()) {
    const next = replaceExt(row.image);
    if (next) {
      await prisma.facility.update({ where: { id: row.id }, data: { image: next } });
      console.log('facility', row.name, '→', next);
    }
  }
  for (const row of await prisma.galleryItem.findMany()) {
    const next = replaceExt(row.image);
    if (next) {
      await prisma.galleryItem.update({ where: { id: row.id }, data: { image: next } });
      console.log('gallery', row.title, '→', next);
    }
  }

  console.log('JPEG compress + DB path update done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
