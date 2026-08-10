import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const r = await prisma.program.updateMany({
  where: { title: { equals: 'Testing', mode: 'insensitive' } },
  data: { image: '/uploads/seed-programs-advanced.jpg' },
});
console.log('updated Testing image', r.count);
await prisma.$disconnect();
