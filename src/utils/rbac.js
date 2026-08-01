import prisma from '../config/db.js';

export async function writeAuditLog({
  userId,
  action,
  entity,
  entityId,
  details,
  req,
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action,
        entity: entity || null,
        entityId: entityId || null,
        details: typeof details === 'string' ? details : details ? JSON.stringify(details) : null,
        ip: req?.headers?.['x-forwarded-for']?.toString()?.split(',')[0]?.trim() || req?.ip || null,
        userAgent: req?.headers?.['user-agent']?.slice(0, 500) || null,
      },
    });
  } catch {
    /* never block main flow */
  }
}

export function serializeUser(user, permissions = []) {
  if (!user) return null;
  const { password, ...rest } = user;
  const roleRef = user.roleRef
    ? {
        id: user.roleRef.id,
        name: user.roleRef.name,
        slug: user.roleRef.slug,
        description: user.roleRef.description,
        isSystem: user.roleRef.isSystem,
      }
    : null;

  const roleSlug =
    roleRef?.slug || (user.role === 'admin' ? 'super_admin' : user.role === 'user' ? 'staff' : user.role);

  return {
    id: rest.id,
    _id: rest.id,
    name: rest.name,
    username: rest.username || null,
    email: rest.email,
    mobile: rest.mobile || null,
    profileImage: rest.profileImage || null,
    role: rest.role,
    roleId: rest.roleId || null,
    roleSlug,
    roleName: roleRef?.name || (rest.role === 'admin' ? 'Super Admin' : 'User'),
    roleRef,
    isActive: rest.isActive,
    lastLoginAt: rest.lastLoginAt || null,
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
    permissions,
    canAccessAdmin: permissions.includes('dashboard.view') || permissions.length > 0 || rest.role === 'admin',
    isSuperAdmin: roleSlug === 'super_admin' || (rest.role === 'admin' && !rest.roleId),
  };
}

export async function getUserPermissions(user) {
  if (!user) return [];

  // Legacy admin without RBAC role → full access
  if (user.role === 'admin' && !user.roleId) {
    const all = await prisma.permission.findMany({ select: { key: true } });
    if (all.length) return all.map((p) => p.key);
    // fallback if permissions not seeded yet
    return ['*.*'];
  }

  if (!user.roleId) return [];

  const rows = await prisma.rolePermission.findMany({
    where: { roleId: user.roleId, allowed: true },
    include: { permission: { select: { key: true } } },
  });
  return rows.map((r) => r.permission.key);
}

export async function loadUserWithRole(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { roleRef: true },
  });
}
