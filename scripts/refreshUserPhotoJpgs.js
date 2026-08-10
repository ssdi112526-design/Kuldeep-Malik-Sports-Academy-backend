import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, '../../client/package.json'));
const sharp = require('sharp');
const prisma = new PrismaClient();

const CLIENT = path.resolve(__dirname, '../../client/src/assets/akhada');
const UPLOADS = path.resolve(__dirname, '../uploads');
const SEED = path.resolve(__dirname, '../seed-media');

const FILES = [
  'programs-beginner',
  'programs-strength-hd',
  'programs-strength',
  'programs-mud-hd',
  'programs-advanced',
  'programs-yoga',
  'facilities-mud',
  'facilities-gym',
  'facilities-mats',
  'facilities-outdoor',
  'gallery-action-1',
  'gallery-action-2',
  'gallery-competition',
  'gallery-mitti',
  'gallery-yoga',
  'gallery-recovery',
  'gallery-running',
  'gallery-rope',
  'gallery-jori',
  'gallery-team',
  'gallery-medal',
];

async function main() {
  for (const base of FILES) {
    const src = path.join(CLIENT, `${base}.png`);
    if (!fs.existsSync(src)) {
      console.warn('missing', base);
      continue;
    }
    const jpg = `seed-${base}.jpg`;
    const dest = path.join(UPLOADS, jpg);
    await sharp(src)
      .resize({ width: 1200, height: 900, fit: 'cover', position: 'attention' })
      .jpeg({ quality: 78, mozjpeg: true, progressive: true })
      .toFile(dest);
    fs.copyFileSync(dest, path.join(SEED, jpg));
    console.log('jpg', jpg, `${Math.round(fs.statSync(dest).size / 1024)}KB`);
  }

  // Ensure CMS points at jpg seeds
  const programMap = [
    ['Beginner Wrestling', '/uploads/seed-programs-beginner.jpg'],
    ['Strength Training', '/uploads/seed-programs-strength-hd.jpg'],
    ['Mud Practice', '/uploads/seed-programs-mud-hd.jpg'],
    ['Advanced Wrestling', '/uploads/seed-programs-advanced.jpg'],
    ['Yoga & Mobility', '/uploads/seed-programs-yoga.jpg'],
  ];
  for (const [title, image] of programMap) {
    await prisma.program.updateMany({
      where: { title: { equals: title, mode: 'insensitive' } },
      data: { image, isActive: true },
    });
  }

  const galleryMap = [
    ['Competition intensity', '/uploads/seed-gallery-competition.jpg'],
    ['Mud practice dawn', '/uploads/seed-gallery-mitti.jpg'],
    ['Sunrise conditioning run', '/uploads/seed-gallery-running.jpg'],
    ['Rope climb power', '/uploads/seed-gallery-rope.jpg'],
    ['Jori club training', '/uploads/seed-gallery-jori.jpg'],
    ['Academy team spirit', '/uploads/seed-gallery-team.jpg'],
    ['Medal ceremony glory', '/uploads/seed-gallery-medal.jpg'],
    ['Yoga & mobility', '/uploads/seed-gallery-yoga.jpg'],
    ['Recovery after practice', '/uploads/seed-gallery-recovery.jpg'],
    ['Advanced technique', '/uploads/seed-gallery-action-1.jpg'],
  ];
  for (const [title, image] of galleryMap) {
    await prisma.galleryItem.updateMany({
      where: { title: { equals: title, mode: 'insensitive' } },
      data: { image },
    });
  }

  const facilityMap = [
    ['Mud Arena', '/uploads/seed-facilities-mud.jpg'],
    ['Strength Gym', '/uploads/seed-facilities-gym.jpg'],
    ['Wrestling Mats', '/uploads/seed-facilities-mats.jpg'],
    ['Outdoor Ground', '/uploads/seed-facilities-outdoor.jpg'],
  ];
  for (const [name, image] of facilityMap) {
    await prisma.facility.updateMany({
      where: { name: { equals: name, mode: 'insensitive' } },
      data: { image, isActive: true },
    });
  }

  console.log('CMS refreshed to user wrestling photos');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
