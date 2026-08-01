import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { writeAuditLog, serializeUser } from '../utils/rbac.js';
import { toPublicPath } from '../middleware/upload.js';

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const MOBILE_RE = /^[6-9]\d{9}$/;

function publicUser(u) {
  return serializeUser(u, []);
}

export const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const search = (req.query.search || '').trim();
  const roleId = req.query.roleId || undefined;
  const status = req.query.status; // active | inactive | all

  const where = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { username: { contains: search, mode: 'insensitive' } },
      { mobile: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (roleId) where.roleId = roleId;
  if (status === 'active') where.isActive = true;
  if (status === 'inactive') where.isActive = false;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { roleRef: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    success: true,
    data: {
      users: rows.map((u) => publicUser(u)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { roleRef: true },
  });
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ success: true, data: { user: publicUser(user) } });
});

export const createUser = asyncHandler(async (req, res) => {
  const {
    name,
    username,
    email,
    mobile,
    password,
    confirmPassword,
    roleId,
    isActive = true,
  } = req.body;

  if (!name?.trim() || !username?.trim() || !email?.trim() || !password || !roleId) {
    throw new ApiError(400, 'Name, username, email, password and role are required');
  }
  if (password !== confirmPassword) {
    throw new ApiError(400, 'Passwords do not match');
  }
  if (!STRONG_PASSWORD.test(password)) {
    throw new ApiError(400, 'Password must be 8+ chars with upper, lower and a number');
  }
  if (mobile && !MOBILE_RE.test(String(mobile).replace(/\D/g, '').slice(-10))) {
    throw new ApiError(400, 'Enter a valid 10-digit Indian mobile number');
  }

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw new ApiError(400, 'Invalid role');

  if (!req.user.isSuperAdmin && role.slug === 'super_admin') {
    throw new ApiError(403, 'Only Super Admin can assign Super Admin role');
  }

  const emailNorm = email.toLowerCase().trim();
  const usernameNorm = username.toLowerCase().trim();

  if (await prisma.user.findUnique({ where: { email: emailNorm } })) {
    throw new ApiError(400, 'Email is already registered');
  }
  if (await prisma.user.findUnique({ where: { username: usernameNorm } })) {
    throw new ApiError(400, 'Username is already taken');
  }

  let profileImage = null;
  if (req.file) {
    profileImage = toPublicPath(req.file.filename);
  }

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      username: usernameNorm,
      email: emailNorm,
      mobile: mobile ? String(mobile).replace(/\D/g, '').slice(-10) : null,
      password: await bcrypt.hash(password, 12),
      roleId: role.id,
      role: role.slug === 'super_admin' || role.slug === 'admin' ? 'admin' : 'user',
      isActive: isActive === true || isActive === 'true' || isActive === 'Active',
      profileImage,
    },
    include: { roleRef: true },
  });

  await writeAuditLog({
    userId: req.user.id,
    action: 'create_user',
    entity: 'user',
    entityId: user.id,
    details: { email: user.email, role: role.slug },
    req,
  });

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: { user: publicUser(user) },
  });
});

export const updateUser = asyncHandler(async (req, res) => {
  const existing = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { roleRef: true },
  });
  if (!existing) throw new ApiError(404, 'User not found');

  const { name, username, email, mobile, roleId, isActive } = req.body;
  const data = {};

  if (name != null) data.name = String(name).trim();
  if (username != null) {
    const usernameNorm = String(username).toLowerCase().trim();
    const clash = await prisma.user.findFirst({
      where: { username: usernameNorm, NOT: { id: existing.id } },
    });
    if (clash) throw new ApiError(400, 'Username is already taken');
    data.username = usernameNorm;
  }
  if (email != null) {
    const emailNorm = String(email).toLowerCase().trim();
    const clash = await prisma.user.findFirst({
      where: { email: emailNorm, NOT: { id: existing.id } },
    });
    if (clash) throw new ApiError(400, 'Email is already registered');
    data.email = emailNorm;
  }
  if (mobile !== undefined) {
    if (mobile && !MOBILE_RE.test(String(mobile).replace(/\D/g, '').slice(-10))) {
      throw new ApiError(400, 'Enter a valid 10-digit Indian mobile number');
    }
    data.mobile = mobile ? String(mobile).replace(/\D/g, '').slice(-10) : null;
  }
  if (roleId) {
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new ApiError(400, 'Invalid role');
    if (!req.user.isSuperAdmin && role.slug === 'super_admin') {
      throw new ApiError(403, 'Only Super Admin can assign Super Admin role');
    }
    data.roleId = role.id;
    data.role = role.slug === 'super_admin' || role.slug === 'admin' ? 'admin' : 'user';
  }
  if (isActive !== undefined) {
    data.isActive = isActive === true || isActive === 'true' || isActive === 'Active';
  }
  if (req.file) {
    data.profileImage = toPublicPath(req.file.filename);
  }

  const user = await prisma.user.update({
    where: { id: existing.id },
    data,
    include: { roleRef: true },
  });

  await writeAuditLog({
    userId: req.user.id,
    action: 'update_user',
    entity: 'user',
    entityId: user.id,
    details: data,
    req,
  });

  res.json({ success: true, message: 'User updated', data: { user: publicUser(user) } });
});

export const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    throw new ApiError(400, 'You cannot delete your own account');
  }
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'User not found');

  await prisma.user.delete({ where: { id: existing.id } });
  await writeAuditLog({
    userId: req.user.id,
    action: 'delete_user',
    entity: 'user',
    entityId: existing.id,
    details: { email: existing.email },
    req,
  });

  res.json({ success: true, message: 'User deleted' });
});

export const setUserStatus = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) {
    throw new ApiError(400, 'You cannot deactivate your own account');
  }
  const isActive = req.body.isActive === true || req.body.isActive === 'true';
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive },
    include: { roleRef: true },
  });
  await writeAuditLog({
    userId: req.user.id,
    action: isActive ? 'enable_user' : 'disable_user',
    entity: 'user',
    entityId: user.id,
    req,
  });
  res.json({ success: true, message: isActive ? 'User enabled' : 'User disabled', data: { user: publicUser(user) } });
});

export const resetUserPassword = asyncHandler(async (req, res) => {
  const { password, confirmPassword, generate } = req.body;
  let nextPassword = password;

  if (generate) {
    nextPassword = crypto.randomBytes(6).toString('base64url') + 'A1a';
  } else {
    if (!password || password !== confirmPassword) {
      throw new ApiError(400, 'Password and confirm password must match');
    }
    if (!STRONG_PASSWORD.test(password)) {
      throw new ApiError(400, 'Password must be 8+ chars with upper, lower and a number');
    }
  }

  await prisma.user.update({
    where: { id: req.params.id },
    data: { password: await bcrypt.hash(nextPassword, 12) },
  });

  await writeAuditLog({
    userId: req.user.id,
    action: 'reset_password',
    entity: 'user',
    entityId: req.params.id,
    req,
  });

  res.json({
    success: true,
    message: 'Password reset successfully',
    data: generate ? { temporaryPassword: nextPassword } : {},
  });
});

export const generatePassword = asyncHandler(async (_req, res) => {
  const temporaryPassword = crypto.randomBytes(6).toString('base64url') + 'A1a';
  res.json({ success: true, data: { temporaryPassword } });
});
