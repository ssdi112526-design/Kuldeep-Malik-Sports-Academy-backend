/**
 * One-time sync: refresh program/facility/gallery image paths to new seed assets
 * and ensure Beginner Wrestling exists. Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function upsertProgram({ title, description, image, displayOrder }) {
  const existing = await prisma.program.findFirst({
    where: { title: { equals: title, mode: 'insensitive' } },
  });
  if (existing) {
    await prisma.program.update({
      where: { id: existing.id },
      data: { description, image, displayOrder, isActive: true },
    });
    console.log('Updated program:', title);
  } else {
    await prisma.program.create({
      data: { title, description, image, displayOrder, isActive: true },
    });
    console.log('Created program:', title);
  }
}

async function main() {
  const programs = [
    {
      title: 'Beginner Wrestling',
      description: 'Foundations of stance, grip, and discipline for new pehlwans.',
      image: '/uploads/seed-programs-beginner.jpg',
      displayOrder: 1,
    },
    {
      title: 'Strength Training',
      description: 'Jori, gada, and functional power built the pehlwani way.',
      image: '/uploads/seed-programs-strength-hd.jpg',
      displayOrder: 2,
    },
    {
      title: 'Mud Practice',
      description: 'Authentic kushti sessions in the mitti arena.',
      image: '/uploads/seed-programs-mud-hd.jpg',
      displayOrder: 3,
    },
    {
      title: 'Advanced Wrestling',
      description: 'Competition technique, counters, and match intelligence.',
      image: '/uploads/seed-programs-advanced.jpg',
      displayOrder: 4,
    },
  ];

  for (const p of programs) await upsertProgram(p);

  const facilityMap = [
    { name: 'Mud Arena', image: '/uploads/seed-facilities-mud.jpg' },
    { name: 'Nutrition Support', image: '/uploads/seed-facilities-nutrition.jpg' },
    { name: 'Recovery Area', image: '/uploads/seed-facilities-recovery.jpg' },
  ];
  for (const f of facilityMap) {
    const rows = await prisma.facility.findMany({
      where: { name: { equals: f.name, mode: 'insensitive' } },
    });
    for (const row of rows) {
      await prisma.facility.update({ where: { id: row.id }, data: { image: f.image, isActive: true } });
      console.log('Updated facility:', f.name);
    }
  }

  const galleryMap = [
    { title: 'Technique under pressure', image: '/uploads/seed-gallery-action-2.jpg' },
    { title: 'Breath, balance, recovery', image: '/uploads/seed-gallery-yoga.jpg' },
    { title: 'Competition intensity', image: '/uploads/seed-gallery-competition.jpg' },
    { title: 'Traditional strength', image: '/uploads/seed-programs-strength.jpg' },
    { title: 'Cleanse and rise again', image: '/uploads/seed-gallery-recovery.jpg' },
    { title: 'Rooted in the earth', image: '/uploads/seed-gallery-mitti.jpg' },
  ];
  for (const g of galleryMap) {
    const rows = await prisma.galleryItem.findMany({
      where: { title: { equals: g.title, mode: 'insensitive' } },
    });
    for (const row of rows) {
      await prisma.galleryItem.update({ where: { id: row.id }, data: { image: g.image } });
      console.log('Updated gallery:', g.title);
    }
  }

  console.log('CMS wrestling images synced.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
