/**
 * Ensure admin user exists and reset password from .env
 * Usage: node scripts/resetAdminPassword.js
 */
import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import prisma from '../src/config/db.js';
import { seedRbac } from '../src/seed/seedRbac.js';

const email = (process.env.ADMIN_EMAIL || 'fastrecovery26@gmail.com').toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'Admin@123456';

async function main() {
  const hashed = await bcrypt.hash(password, 12);
  let user = await prisma.user.findUnique({ where: { email }, include: { roleRef: true } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'Ashwani Kumar',
        email,
        username: 'superadmin',
        password: hashed,
        role: 'admin',
        isActive: true,
      },
    });
    console.log('Created admin user:', email);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        isActive: true,
        role: 'admin',
        username: user.username || 'superadmin',
        name:
          !user.name || user.name === 'Admin' || user.name === 'Super Admin'
            ? 'Ashwani Kumar'
            : user.name,
      },
    });
    console.log('Updated admin password for:', email);
  }

  await seedRbac(email);

  const check = await prisma.user.findUnique({
    where: { email },
    include: { roleRef: true },
  });
  const ok = await bcrypt.compare(password, check.password);
  console.log({
    email: check.email,
    username: check.username,
    role: check.role,
    roleSlug: check.roleRef?.slug || null,
    isActive: check.isActive,
    passwordMatchesEnv: ok,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
