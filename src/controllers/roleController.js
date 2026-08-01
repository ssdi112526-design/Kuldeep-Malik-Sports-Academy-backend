import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { writeAuditLog } from '../utils/rbac.js';
import { MENU_DEFINITIONS, buildPermissionCatalog } from '../constants/permissions.js';

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70);
}

export const listPermissionsCatalog = asyncHandler(async (_req, res) => {
  const permissions = await prisma.permission.findMany({ orderBy: [{ menu: 'asc' }, { action: 'asc' }] });
  res.json({
    success: true,
    data: {
      menus: MENU_DEFINITIONS,
      permissions,
      catalog: buildPermissionCatalog(),
    },
  });
});

export const listRoles = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const search = (req.query.search || '').trim();

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, roles] = await Promise.all([
    prisma.role.count({ where }),
    prisma.role.findMany({
      where,
      include: {
        _count: { select: { users: true, permissions: true } },
        permissions: {
          where: { allowed: true },
          include: { permission: { select: { key: true, menu: true, action: true, label: true } } },
        },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        isSystem: r.isSystem,
        userCount: r._count.users,
        permissionCount: r._count.permissions,
        permissions: r.permissions.map((p) => p.permission.key),
        permissionDetails: r.permissions.map((p) => p.permission),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

export const getRole = asyncHandler(async (req, res) => {
  const role = await prisma.role.findUnique({
    where: { id: req.params.id },
    include: {
      permissions: {
        include: { permission: true },
      },
      _count: { select: { users: true } },
    },
  });
  if (!role) throw new ApiError(404, 'Role not found');

  res.json({
    success: true,
    data: {
      role: {
        id: role.id,
        name: role.name,
        slug: role.slug,
        description: role.description,
        isSystem: role.isSystem,
        userCount: role._count.users,
        permissions: role.permissions.filter((p) => p.allowed).map((p) => p.permission.key),
        permissionDetails: role.permissions.filter((p) => p.allowed).map((p) => p.permission),
      },
    },
  });
});

async function syncRolePermissions(roleId, permissionKeys = []) {
  const all = await prisma.permission.findMany();
  const keyToId = Object.fromEntries(all.map((p) => [p.key, p.id]));
  const wanted = new Set(permissionKeys.filter((k) => keyToId[k]));

  const existing = await prisma.rolePermission.findMany({ where: { roleId } });
  const existingMap = new Map(existing.map((e) => [e.permissionId, e]));

  for (const perm of all) {
    const allowed = wanted.has(perm.key);
    const row = existingMap.get(perm.id);
    if (row) {
      if (row.allowed !== allowed) {
        await prisma.rolePermission.update({ where: { id: row.id }, data: { allowed } });
      }
    } else if (allowed) {
      await prisma.rolePermission.create({
        data: { roleId, permissionId: perm.id, allowed: true },
      });
    }
  }
}

export const createRole = asyncHandler(async (req, res) => {
  const { name, description, permissions = [] } = req.body;
  if (!name?.trim()) throw new ApiError(400, 'Role name is required');

  let slug = slugify(name);
  if (!slug) throw new ApiError(400, 'Invalid role name');
  const clash = await prisma.role.findUnique({ where: { slug } });
  if (clash) slug = `${slug}_${Date.now().toString(36)}`;

  const role = await prisma.role.create({
    data: {
      name: name.trim(),
      slug,
      description: description?.trim() || null,
      isSystem: false,
    },
  });

  await syncRolePermissions(role.id, permissions);
  await writeAuditLog({
    userId: req.user.id,
    action: 'create_role',
    entity: 'role',
    entityId: role.id,
    details: { name: role.name, permissions },
    req,
  });

  const full = await prisma.role.findUnique({
    where: { id: role.id },
    include: { permissions: { where: { allowed: true }, include: { permission: true } } },
  });

  res.status(201).json({
    success: true,
    message: 'Role created',
    data: {
      role: {
        ...full,
        permissions: full.permissions.map((p) => p.permission.key),
      },
    },
  });
});

export const updateRole = asyncHandler(async (req, res) => {
  const existing = await prisma.role.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Role not found');

  const { name, description, permissions } = req.body;
  const data = {};
  if (name != null) data.name = String(name).trim();
  if (description !== undefined) data.description = description?.trim() || null;

  // System roles: allow permission updates, but not rename slug / delete
  if (existing.isSystem && name && name.trim() !== existing.name) {
    // allow display name tweak for system roles
    data.name = name.trim();
  }

  const role = await prisma.role.update({ where: { id: existing.id }, data });

  if (Array.isArray(permissions)) {
    if (existing.slug === 'super_admin' && !req.user.isSuperAdmin) {
      throw new ApiError(403, 'Only Super Admin can change Super Admin permissions');
    }
    await syncRolePermissions(role.id, permissions);
  }

  await writeAuditLog({
    userId: req.user.id,
    action: 'update_role',
    entity: 'role',
    entityId: role.id,
    details: { name: role.name, permissions },
    req,
  });

  const full = await getRoleData(role.id);
  res.json({ success: true, message: 'Role updated', data: { role: full } });
});

async function getRoleData(id) {
  const role = await prisma.role.findUnique({
    where: { id },
    include: {
      permissions: { where: { allowed: true }, include: { permission: true } },
      _count: { select: { users: true } },
    },
  });
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description,
    isSystem: role.isSystem,
    userCount: role._count.users,
    permissions: role.permissions.map((p) => p.permission.key),
    permissionDetails: role.permissions.map((p) => p.permission),
  };
}

export const deleteRole = asyncHandler(async (req, res) => {
  const existing = await prisma.role.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { users: true } } },
  });
  if (!existing) throw new ApiError(404, 'Role not found');
  if (existing.isSystem) throw new ApiError(400, 'System roles cannot be deleted');
  if (existing._count.users > 0) {
    throw new ApiError(400, 'Reassign users before deleting this role');
  }

  await prisma.role.delete({ where: { id: existing.id } });
  await writeAuditLog({
    userId: req.user.id,
    action: 'delete_role',
    entity: 'role',
    entityId: existing.id,
    details: { name: existing.name },
    req,
  });

  res.json({ success: true, message: 'Role deleted' });
});

export const cloneRole = asyncHandler(async (req, res) => {
  const source = await prisma.role.findUnique({
    where: { id: req.params.id },
    include: { permissions: { where: { allowed: true }, include: { permission: true } } },
  });
  if (!source) throw new ApiError(404, 'Role not found');

  const baseName = req.body.name?.trim() || `${source.name} Copy`;
  let slug = slugify(baseName);
  if (await prisma.role.findUnique({ where: { slug } })) {
    slug = `${slug}_${Date.now().toString(36)}`;
  }

  const role = await prisma.role.create({
    data: {
      name: baseName,
      slug,
      description: source.description,
      isSystem: false,
    },
  });

  await syncRolePermissions(
    role.id,
    source.permissions.map((p) => p.permission.key)
  );

  await writeAuditLog({
    userId: req.user.id,
    action: 'clone_role',
    entity: 'role',
    entityId: role.id,
    details: { from: source.id, name: role.name },
    req,
  });

  res.status(201).json({
    success: true,
    message: 'Role cloned',
    data: { role: await getRoleData(role.id) },
  });
});
