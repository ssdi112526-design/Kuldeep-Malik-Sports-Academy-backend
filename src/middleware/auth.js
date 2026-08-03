import jwt from 'jsonwebtoken';
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

/**
 * Legacy role string check.
 * IMPORTANT: does NOT grant access merely because the user can open the admin panel.
 * Only Super Admin / legacy admin role / explicit role match.
 */
export const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }

  if (roles.includes('admin')) {
    const slug = req.user.roleSlug;
    if (
      req.user.isSuperAdmin ||
      req.user.role === 'admin' ||
      slug === 'super_admin' ||
      slug === 'admin'
    ) {
      return next();
    }
  }

  if (!roles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  next();
};

function isUnrestricted(req) {
  return Boolean(req.user?.isSuperAdmin || req.permissions?.includes('*.*'));
}

function hasExactPermission(req, key) {
  if (!key) return false;
  return Boolean(req.permissions?.includes(key));
}

/**
 * Require ALL listed permission keys (AND).
 * Each key is checked independently — no inheritance (view ≠ edit, etc.).
 */
export const requirePermission = (...keys) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  if (isUnrestricted(req)) return next();

  const required = keys.filter(Boolean);
  if (!required.length) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }

  const ok = required.every((k) => hasExactPermission(req, k));
  if (!ok) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  next();
};

/**
 * Require ANY of the listed permission keys (OR).
 * Used for read/list endpoints so create/edit/delete-only roles can load data
 * without treating view as granting those write actions.
 */
export const requireAnyPermission = (...keys) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  if (isUnrestricted(req)) return next();

  const required = keys.filter(Boolean);
  if (!required.length) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }

  const ok = required.some((k) => hasExactPermission(req, k));
  if (!ok) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  next();
};

/** Must be able to open admin panel — students and portal coaches always rejected */
export const requireAdminAccess = (req, res, next) => {
  if (
    req.user?.isStudent ||
    req.user?.isCoach ||
    req.user?.role === 'student' ||
    req.user?.role === 'coach' ||
    req.user?.accountType === 'student' ||
    req.user?.accountType === 'coach'
  ) {
    return next(new ApiError(403, "You don't have permission to access the admin panel."));
  }
  if (!req.user?.canAccessAdmin && !req.user?.isSuperAdmin && req.user?.role !== 'admin') {
    return next(new ApiError(403, "You don't have permission to access the admin panel."));
  }
  next();
};

/** Student portal only */
export const requireStudent = (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  if (!req.user.isStudent && req.user.role !== 'student' && req.user.accountType !== 'student') {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  if (!req.user.studentId) {
    return next(new ApiError(403, 'Student account is not linked.'));
  }
  next();
};

/** Coach user panel only */
export const requireCoach = (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  if (!req.user.isCoach && req.user.role !== 'coach' && req.user.accountType !== 'coach') {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  if (!req.user.coachId) {
    return next(new ApiError(403, 'Coach account is not linked.'));
  }
  next();
};

/** Require one of the listed role slugs (or legacy role enum) */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  const slug = req.user.roleSlug;
  const role = req.user.role;
  const ok = roles.some((r) => r === slug || r === role || (r === 'admin' && (req.user.isSuperAdmin || role === 'admin')));
  if (!ok) {
    return next(new ApiError(403, 'You do not have permission to perform this action.'));
  }
  next();
};
