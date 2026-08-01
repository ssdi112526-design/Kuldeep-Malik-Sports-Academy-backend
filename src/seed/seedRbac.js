import bcrypt from 'bcryptjs';
import prisma from '../config/db.js';
import {
  SYSTEM_ROLES,
  buildPermissionCatalog,
  getSystemRolePermissionKeys,
  REMOVED_ROLE_MENUS,
} from '../constants/permissions.js';

export async function seedRbac(existingAdminEmail) {
  const catalog = buildPermissionCatalog();
  const catalogKeys = new Set(catalog.map((p) => p.key));

  // Remove obsolete role-management menus from DB
  await prisma.rolePermission.deleteMany({
    where: { permission: { menu: { in: REMOVED_ROLE_MENUS } } },
  });
  await prisma.permission.deleteMany({
    where: { menu: { in: REMOVED_ROLE_MENUS } },
  });

  for (const perm of catalog) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { menu: perm.menu, action: perm.action, label: perm.label },
      create: perm,
    });
  }

  const allPerms = await prisma.permission.findMany();
  const keyToId = Object.fromEntries(allPerms.map((p) => [p.key, p.id]));
  const allKeys = allPerms.map((p) => p.key).filter((k) => catalogKeys.has(k));
  const roleKeysMap = getSystemRolePermissionKeys(allKeys);

  const roleBySlug = {};
  for (const def of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { slug: def.slug },
      update: {
        name: def.name,
        description: def.description,
        isSystem: def.isSystem,
      },
      create: {
        name: def.name,
        slug: def.slug,
        description: def.description,
        isSystem: def.isSystem,
      },
    });
    roleBySlug[def.slug] = role;

    const keys = roleKeysMap[def.slug] || [];
    for (const key of keys) {
      const permissionId = keyToId[key];
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId },
        },
        update: { allowed: true },
        create: { roleId: role.id, permissionId, allowed: true },
      });
    }
  }

  // Attach legacy admins to Super Admin role
  const superRole = roleBySlug.super_admin;
  if (superRole) {
    await prisma.user.updateMany({
      where: { role: 'admin', roleId: null },
      data: { roleId: superRole.id },
    });
  }

  // Ensure seeded admin has username + super admin role
  if (existingAdminEmail && superRole) {
    const admin = await prisma.user.findUnique({ where: { email: existingAdminEmail.toLowerCase() } });
    if (admin) {
      await prisma.user.update({
        where: { id: admin.id },
        data: {
          roleId: superRole.id,
          username: admin.username || 'superadmin',
        },
      });
    }
  }

  return { permissions: allPerms.length, roles: SYSTEM_ROLES.length };
}

/** Standalone seed when run directly */
async function main() {
  const email = process.env.ADMIN_EMAIL || 'fastrecovery26@gmail.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123456';

  let admin = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: email.toLowerCase(),
        username: 'superadmin',
        password: await bcrypt.hash(password, 12),
        role: 'admin',
        isActive: true,
      },
    });
    console.log('Created admin user:', email);
  }

  const result = await seedRbac(email);
  console.log('RBAC seeded:', result);
}

if (process.argv[1] && process.argv[1].includes('seedRbac')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
