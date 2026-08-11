import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

function createPrisma() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

function isStaleClient(client) {
  // After `prisma generate`, a cached client may miss newly added models.
  return !client || typeof client.feature?.count !== 'function' || typeof client.membershipPlan?.count !== 'function';
}

let prisma = globalForPrisma.prisma;
if (isStaleClient(prisma)) {
  prisma = createPrisma();
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
  }
}

export const connectDB = async () => {
  await prisma.$connect();
  console.log('PostgreSQL connected');
  return prisma;
};

export default prisma;
