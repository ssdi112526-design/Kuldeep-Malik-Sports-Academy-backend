import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const wrestlingPool = [
  '/uploads/seed-gallery-action-1.jpg',
  '/uploads/seed-gallery-action-2.jpg',
  '/uploads/seed-gallery-competition.jpg',
  '/uploads/seed-programs-mud-hd.jpg',
  '/uploads/seed-programs-strength.jpg',
  '/uploads/seed-gallery-mitti.jpg',
];

const items = await prisma.galleryItem.findMany();
let i = 0;
for (const row of items) {
  const img = row.image || '';
  if (!img.includes('/uploads/seed-')) {
    const next = wrestlingPool[i % wrestlingPool.length];
    i += 1;
    await prisma.galleryItem.update({ where: { id: row.id }, data: { image: next } });
    console.log('Fixed gallery', row.title, '→', next);
  }
}

await prisma.$disconnect();
console.log('Done');
