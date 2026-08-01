import bcrypt from 'bcryptjs';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import generateToken from '../utils/generateToken.js';
import { writeAuditLog, getUserPermissions, loadUserWithRole, serializeUser } from '../utils/rbac.js';

export const register = asyncHandler(async (req, res) => {
  throw new ApiError(403, 'Public registration is disabled. Ask an administrator to create your account.');
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { roleRef: true },
  });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  if (!user.isActive) {
    throw new ApiError(403, 'Account is deactivated');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const fresh = await loadUserWithRole(user.id);
  const permissions = await getUserPermissions(fresh);
  const safeUser = serializeUser(fresh, permissions);
  const token = generateToken(user.id, safeUser.roleSlug || user.role);

  await writeAuditLog({
    userId: user.id,
    action: 'login',
    entity: 'user',
    entityId: user.id,
    req,
  });

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user: safeUser,
      token,
      permissions,
    },
  });
});

export const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      user: req.user,
      permissions: req.permissions || req.user?.permissions || [],
    },
  });
});

export const logout = asyncHandler(async (req, res) => {
  await writeAuditLog({
    userId: req.user?.id,
    action: 'logout',
    entity: 'user',
    entityId: req.user?.id,
    req,
  });
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});
