import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

function withPoolParams(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '5');
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '20');
    if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '10');
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function createPrisma() {
  return new PrismaClient({
    datasources: { db: { url: withPoolParams(process.env.DATABASE_URL) } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

function isStaleClient(client) {
  // After `prisma generate`, a cached client may miss newly added models.
  return (
    !client ||
    typeof client.feature?.count !== 'function' ||
    typeof client.membershipPlan?.count !== 'function' ||
    typeof client.mediaBlob?.count !== 'function'
  );
}

let prisma = globalForPrisma.prisma;
if (isStaleClient(prisma)) {
  prisma = createPrisma();
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
  }
}

let keepAliveTimer;

export const connectDB = async () => {
  await prisma.$connect();
  if (!keepAliveTimer) {
    keepAliveTimer = setInterval(() => {
      prisma.$queryRaw`SELECT 1`.catch(() => {});
    }, 25_000);
    keepAliveTimer.unref?.();
  }
  console.log('PostgreSQL connected');
  return prisma;
};

export default prisma;
