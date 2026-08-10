import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const keepTitles = new Set(
  [
    'Competition intensity',
    'Mud practice dawn',
    'Sunrise conditioning run',
    'Rope climb power',
    'Jori club training',
    'Academy team spirit',
    'Medal ceremony glory',
    'Yoga & mobility',
    'Recovery after practice',
    'Advanced technique',
  ].map((t) => t.toLowerCase()),
);

const rows = await prisma.galleryItem.findMany();
for (const row of rows) {
  if (!keepTitles.has(String(row.title || '').toLowerCase())) {
    await prisma.galleryItem.delete({ where: { id: row.id } });
    console.log('removed', row.title);
  }
}
console.log('gallery cleaned to', keepTitles.size, 'unique wrestling shots');
await prisma.$disconnect();
