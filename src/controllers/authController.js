import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import generateToken from '../utils/generateToken.js';
import { writeAuditLog, getUserPermissions, loadUserWithRole, serializeUser } from '../utils/rbac.js';
import { sendPasswordResetEmail } from '../services/emailService.js';

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const INACTIVE_ACCOUNT = 'Your account is currently inactive. Please contact the administrator.';
const RESET_TOKEN_HOURS = 1;

function clientBaseUrl() {
  const raw = process.env.CLIENT_URL || 'http://localhost:5173';
  return String(raw).split(',')[0].trim() || 'http://localhost:5173';
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const register = asyncHandler(async (req, res) => {
  throw new ApiError(403, 'Public registration is disabled. Ask an administrator to create your account.');
});

export const login = asyncHandler(async (req, res) => {
  const loginId = String(req.body.login || req.body.email || req.body.username || '')
    .trim()
    .toLowerCase();
  const { password } = req.body;

  if (!loginId || !password) {
    throw new ApiError(400, 'Login ID and password are required');
  }

  let user = await prisma.user.findFirst({
    where: {
      OR: [{ email: loginId }, { username: loginId }],
    },
    include: { roleRef: true, student: true, coach: true },
  });

  // Also allow login by student registration number / coach code stored as username
  if (!user) {
    user = await prisma.user.findFirst({
      where: { username: loginId },
      include: { roleRef: true, student: true, coach: true },
    });
  }

  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new ApiError(401, 'Invalid login ID or password');
  }

  if (!user.isActive) {
    throw new ApiError(403, INACTIVE_ACCOUNT);
  }

  if (user.role === 'student' || user.studentId) {
    if (!user.student || user.student.status !== 'Active') {
      throw new ApiError(403, 'Your student account is not active. Please contact the Academy administrator.');
    }
  }

  if (user.role === 'coach' || user.coachId) {
    if (!user.coach || user.coach.status !== 'Active') {
      throw new ApiError(403, INACTIVE_ACCOUNT);
    }
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
      permissions: safeUser.permissions,
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

/** Self-service change password (current password required) */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (!currentPassword || !newPassword || !confirmPassword) {
    throw new ApiError(400, 'Current password, new password and confirm password are required');
  }
  if (newPassword !== confirmPassword) {
    throw new ApiError(400, 'New passwords do not match');
  }
  if (!STRONG_PASSWORD.test(newPassword)) {
    throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new ApiError(404, 'User not found');
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw new ApiError(400, 'Current password is incorrect');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await bcrypt.hash(newPassword, 12),
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    action: 'change_password',
    entity: 'user',
    entityId: user.id,
    req,
  });

  res.json({ success: true, message: 'Password changed successfully' });
});

/**
 * Step-up password check for already-authenticated users (e.g. mobile Controller unlock).
 * Uses the SEPARATE controllerPassword — never the login password.
 */
export const verifyPassword = asyncHandler(async (req, res) => {
  const password = String(req.body.password || req.body.currentPassword || '');
  if (!password) throw new ApiError(400, 'Controller password is required');

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new ApiError(404, 'User not found');
  if (!user.isActive) throw new ApiError(403, INACTIVE_ACCOUNT);

  if (!user.controllerPassword) {
    throw new ApiError(
      400,
      'Controller password is not set. Create a Controller password first.',
      'CONTROLLER_PASSWORD_NOT_SET'
    );
  }

  const ok = await bcrypt.compare(password, user.controllerPassword);
  if (!ok) throw new ApiError(401, 'Incorrect Controller password');

  await writeAuditLog({
    userId: user.id,
    action: 'controller_password_verify',
    entity: 'user',
    entityId: user.id,
    details: { purpose: 'controller_unlock' },
    req,
  });

  res.json({ success: true, message: 'Controller password verified' });
});

/** Whether the logged-in user has created a Controller password. */
export const getControllerPasswordStatus = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { controllerPassword: true },
  });
  if (!user) throw new ApiError(404, 'User not found');
  res.json({
    success: true,
    data: { isSet: Boolean(user.controllerPassword) },
  });
});

/**
 * First-time create (or recreate if empty). Requires login password once so only
 * the account owner can set the separate Controller password.
 */
export const setupControllerPassword = asyncHandler(async (req, res) => {
  const loginPassword = String(req.body.loginPassword || req.body.currentPassword || '');
  const password = String(req.body.password || req.body.controllerPassword || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!loginPassword || !password || !confirmPassword) {
    throw new ApiError(400, 'Login password, Controller password and confirm password are required');
  }
  if (password !== confirmPassword) {
    throw new ApiError(400, 'Controller passwords do not match');
  }
  if (!STRONG_PASSWORD.test(password)) {
    throw new ApiError(400, 'Controller password must be 8+ characters with upper, lower and a number');
  }
  if (password === loginPassword) {
    throw new ApiError(400, 'Controller password must be different from your login password');
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new ApiError(404, 'User not found');
  if (!user.isActive) throw new ApiError(403, INACTIVE_ACCOUNT);

  if (!(await bcrypt.compare(loginPassword, user.password))) {
    throw new ApiError(401, 'Login password is incorrect');
  }

  if (user.controllerPassword) {
    throw new ApiError(400, 'Controller password already exists. Use forgot/reset to change it.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      controllerPassword: await bcrypt.hash(password, 12),
      controllerPasswordResetToken: null,
      controllerPasswordResetExpires: null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    action: 'controller_password_setup',
    entity: 'user',
    entityId: user.id,
    req,
  });

  res.status(201).json({
    success: true,
    message: 'Controller password created successfully',
    data: { isSet: true },
  });
});

/** Logged-in admin: email a Controller password reset token. */
export const forgotControllerPassword = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { student: true, coach: true },
  });
  if (!user) throw new ApiError(404, 'User not found');
  if (!user.isActive) throw new ApiError(403, INACTIVE_ACCOUNT);

  const generic = {
    success: true,
    message:
      'If an email is on file, Controller password reset instructions have been sent. Check your inbox.',
  };

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(rawToken);
  const expires = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      controllerPasswordResetToken: tokenHash,
      controllerPasswordResetExpires: expires,
    },
  });

  const resetUrl = `${clientBaseUrl()}/reset-controller-password?token=${rawToken}`;
  const emailTarget =
    user.email && !user.email.endsWith('@student.akhada.local') && !user.email.endsWith('@coach.akhada.local')
      ? user.email
      : user.student?.email || user.coach?.email || null;

  let emailed = false;
  if (emailTarget) {
    emailed = await sendPasswordResetEmail({
      to: emailTarget,
      name: user.name,
      resetUrl,
      expiresInHours: RESET_TOKEN_HOURS,
      purpose: 'controller',
    });
  }

  const data = {};
  // Always return token to the authenticated mobile client so reset works even without email.
  data.resetToken = rawToken;
  data.expiresInHours = RESET_TOKEN_HOURS;
  if (!emailed) {
    data.devHint = emailTarget
      ? 'Email could not be sent — use the reset token shown in the app.'
      : 'No email on file — use the reset token shown in the app.';
  } else {
    data.emailedTo = emailTarget.replace(/(.{2}).+(@.+)/, '$1***$2');
  }

  await writeAuditLog({
    userId: user.id,
    action: 'controller_password_forgot',
    entity: 'user',
    entityId: user.id,
    details: { emailed: Boolean(emailed) },
    req,
  });

  res.json({ ...generic, data });
});

/** Reset Controller password with token from forgot flow (does not change login password). */
export const resetControllerPassword = asyncHandler(async (req, res) => {
  const { token, password, confirmPassword, newPassword } = req.body;
  const nextPassword = password || newPassword;

  if (!token) throw new ApiError(400, 'Reset token is required');
  if (!nextPassword || !confirmPassword) {
    throw new ApiError(400, 'New Controller password and confirm password are required');
  }
  if (nextPassword !== confirmPassword) {
    throw new ApiError(400, 'Passwords do not match');
  }
  if (!STRONG_PASSWORD.test(nextPassword)) {
    throw new ApiError(400, 'Controller password must be 8+ characters with upper, lower and a number');
  }

  const tokenHash = hashResetToken(String(token).trim());
  const user = await prisma.user.findFirst({
    where: {
      controllerPasswordResetToken: tokenHash,
      controllerPasswordResetExpires: { gt: new Date() },
    },
  });

  if (!user) {
    throw new ApiError(400, 'Invalid or expired reset token. Please request a new one.');
  }

  // Reject if identical to login password
  if (await bcrypt.compare(nextPassword, user.password)) {
    throw new ApiError(400, 'Controller password must be different from your login password');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      controllerPassword: await bcrypt.hash(nextPassword, 12),
      controllerPasswordResetToken: null,
      controllerPasswordResetExpires: null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    action: 'controller_password_reset',
    entity: 'user',
    entityId: user.id,
    details: { via: 'token' },
    req,
  });

  res.json({
    success: true,
    message: 'Controller password reset successfully.',
    data: { isSet: true },
  });
});

/**
 * Forgot password — accepts username, email, or mobile.
 * Always returns a generic success message (no account enumeration).
 * If email is available, sends reset link.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const identifier = String(req.body.identifier || req.body.email || req.body.username || req.body.login || '')
    .trim()
    .toLowerCase();
  const mobileDigits = String(req.body.identifier || req.body.mobile || '')
    .replace(/\D/g, '')
    .slice(-10);

  if (!identifier && !mobileDigits) {
    throw new ApiError(400, 'Please enter your username, email or mobile number');
  }

  const or = [];
  if (identifier) {
    or.push({ email: identifier }, { username: identifier });
  }
  if (mobileDigits.length === 10) {
    or.push({ mobile: mobileDigits });
  }

  const user = or.length
    ? await prisma.user.findFirst({
        where: { OR: or },
        include: { student: true, coach: true },
      })
    : null;

  const generic = {
    success: true,
    message:
      'If an account matches that information, password reset instructions have been sent. Check your email.',
  };

  if (!user || !user.isActive) {
    return res.json(generic);
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(rawToken);
  const expires = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: tokenHash,
      passwordResetExpires: expires,
    },
  });

  const resetUrl = `${clientBaseUrl()}/reset-password?token=${rawToken}`;
  const emailTarget =
    user.email && !user.email.endsWith('@student.akhada.local') && !user.email.endsWith('@coach.akhada.local')
      ? user.email
      : user.student?.email || user.coach?.email || null;

  let emailed = false;
  if (emailTarget) {
    emailed = await sendPasswordResetEmail({
      to: emailTarget,
      name: user.name,
      resetUrl,
      expiresInHours: RESET_TOKEN_HOURS,
    });
  }

  // Dev / no-email fallback: return reset URL only in non-production
  const data = {};
  if (!emailed && process.env.NODE_ENV !== 'production') {
    data.resetUrl = resetUrl;
    data.devHint = 'Email not configured — use this link to reset (dev only)';
  }

  await writeAuditLog({
    userId: user.id,
    action: 'forgot_password',
    entity: 'user',
    entityId: user.id,
    details: { emailed: Boolean(emailed) },
    req,
  });

  res.json({
    ...generic,
    data,
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password, confirmPassword, newPassword } = req.body;
  const nextPassword = password || newPassword;

  if (!token) throw new ApiError(400, 'Reset token is required');
  if (!nextPassword || !confirmPassword) {
    throw new ApiError(400, 'New password and confirm password are required');
  }
  if (nextPassword !== confirmPassword) {
    throw new ApiError(400, 'Passwords do not match');
  }
  if (!STRONG_PASSWORD.test(nextPassword)) {
    throw new ApiError(400, 'Password must be 8+ characters with upper, lower and a number');
  }

  const tokenHash = hashResetToken(String(token).trim());
  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: tokenHash,
      passwordResetExpires: { gt: new Date() },
    },
  });

  if (!user) {
    throw new ApiError(400, 'Invalid or expired reset link. Please request a new password reset.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await bcrypt.hash(nextPassword, 12),
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    action: 'reset_password',
    entity: 'user',
    entityId: user.id,
    details: { via: 'token' },
    req,
  });

  res.json({
    success: true,
    message: 'Password reset successfully. You can now log in.',
  });
});
