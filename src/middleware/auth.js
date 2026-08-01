import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getUserPermissions, loadUserWithRole, serializeUser } from '../utils/rbac.js';

export const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    throw new ApiError(401, 'Not authorized. Please log in.');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await loadUserWithRole(decoded.id);

    if (!user || !user.isActive) {
      throw new ApiError(401, 'User not found or inactive.');
    }

    const permissions = await getUserPermissions(user);
    req.user = serializeUser(user, permissions);
    req.permissions = permissions;
    next();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'Invalid or expired token.');
  }
});

/** Legacy role string check (admin | user) — admin panel operators */
export const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(403, 'You do not have permission for this action.'));
  }
  if (roles.includes('admin')) {
    const slug = req.user.roleSlug;
    if (
      req.user.isSuperAdmin ||
      req.user.role === 'admin' ||
      slug === 'super_admin' ||
      slug === 'admin' ||
      req.user.canAccessAdmin
    ) {
      return next();
    }
  }
  if (!roles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission for this action.'));
  }
  next();
};

export const requirePermission = (...keys) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(403, 'Access Denied'));
  }
  if (req.user.isSuperAdmin || req.permissions?.includes('*.*')) {
    return next();
  }
  const ok = keys.some((k) => req.permissions?.includes(k));
  if (!ok) {
    return next(new ApiError(403, "You don't have permission to access this resource."));
  }
  next();
};

export const requireAnyPermission = requirePermission;

/** Must be able to open admin panel */
export const requireAdminAccess = (req, res, next) => {
  if (!req.user?.canAccessAdmin && !req.user?.isSuperAdmin && req.user?.role !== 'admin') {
    return next(new ApiError(403, "You don't have permission to access the admin panel."));
  }
  next();
};
