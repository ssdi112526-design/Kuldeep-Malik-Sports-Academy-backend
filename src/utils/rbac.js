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
  const { password, passwordResetToken, passwordResetExpires, ...rest } = user;
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
    roleRef?.slug ||
    (user.role === 'admin'
      ? 'super_admin'
      : user.role === 'student'
        ? 'student'
        : user.role === 'coach'
          ? 'coach_portal'
          : user.role === 'parent'
            ? 'parent'
            : user.role === 'user'
              ? 'staff'
              : user.role);

  const isStudent = user.role === 'student' || roleSlug === 'student' || Boolean(user.studentId);
  // Portal coach (linked Coach entity) — not the admin-panel staff role slug "coach"
  const isCoach =
    Boolean(user.coachId) ||
    user.role === 'coach' ||
    roleSlug === 'coach_portal';
  const isParent =
    user.role === 'parent' ||
    roleSlug === 'parent' ||
    Boolean(user.parentProfile);
  const isPortalUser = isStudent || isCoach || isParent;

  const student = user.student
    ? {
        id: user.student.id,
        registrationNumber: user.student.registrationNumber,
        fullName: user.student.fullName,
        photo: user.student.photo,
        status: user.student.status,
        mobileNumber: user.student.mobileNumber,
        email: user.student.email,
        batch: user.student.batch,
        fatherName: user.student.fatherName,
      }
    : null;

  const coach = user.coach
    ? {
        id: user.coach.id,
        coachCode: user.coach.coachCode,
        fullName: user.coach.fullName,
        photo: user.coach.photo,
        status: user.coach.status,
        mobile: user.coach.mobile,
        email: user.coach.email,
        specialization: user.coach.specialization,
        fatherName: user.coach.fatherName,
      }
    : null;

  // Portal users never receive admin panel access
  const safePermissions = isPortalUser ? [] : permissions;

  let accountType = 'staff';
  if (isStudent) accountType = 'student';
  else if (isCoach) accountType = 'coach';
  else if (isParent) accountType = 'parent';

  let roleName = roleRef?.name || 'User';
  if (!roleRef) {
    if (rest.role === 'admin') roleName = 'Super Admin';
    else if (rest.role === 'student') roleName = 'Student';
    else if (rest.role === 'coach') roleName = 'Coach';
    else if (rest.role === 'parent') roleName = 'Parent';
  }

  const parentProfile = user.parentProfile
    ? {
        id: user.parentProfile.id,
        fullName: user.parentProfile.fullName,
        phone: user.parentProfile.phone,
        email: user.parentProfile.email,
        relation: user.parentProfile.relation,
        photo: user.parentProfile.photo || null,
      }
    : null;

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
    roleName,
    roleRef,
    studentId: rest.studentId || null,
    coachId: rest.coachId || null,
    student,
    coach,
    parentProfile,
    accountType,
    isStudent,
    isCoach,
    isParent,
    isActive: rest.isActive,
    lastLoginAt: rest.lastLoginAt || null,
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
    permissions: safePermissions,
    canAccessAdmin: isPortalUser
      ? false
      : safePermissions.includes('dashboard.view') ||
        safePermissions.length > 0 ||
        rest.role === 'admin',
    isSuperAdmin: !isPortalUser && (roleSlug === 'super_admin' || (rest.role === 'admin' && !rest.roleId)),
  };
}

let allPermissionKeysCache = { at: 0, keys: null };
const AUTH_CONTEXT_TTL_MS = 20_000;
const authContextCache = new Map();

async function getAllPermissionKeys() {
  const now = Date.now();
  if (allPermissionKeysCache.keys && now - allPermissionKeysCache.at < 60_000) {
    return allPermissionKeysCache.keys;
  }
  const all = await prisma.permission.findMany({ select: { key: true } });
  const keys = all.length ? all.map((p) => p.key) : ['*.*'];
  allPermissionKeysCache = { at: now, keys };
  return keys;
}

function permissionsFromRoleRef(user) {
  const rows = user?.roleRef?.permissions;
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => r.permission?.key).filter(Boolean);
}

export async function getUserPermissions(user) {
  if (!user) return [];

  // Portal accounts never receive admin permission keys (defense in depth)
  if (
    user.role === 'student' ||
    user.studentId ||
    user.role === 'coach' ||
    user.coachId ||
    user.role === 'parent' ||
    user.parentProfile
  ) {
    return [];
  }

  // Legacy admin without RBAC role → full access
  if (user.role === 'admin' && !user.roleId) {
    return getAllPermissionKeys();
  }

  if (!user.roleId) return [];

  const nested = permissionsFromRoleRef(user);
  if (nested) return nested;

  const rows = await prisma.rolePermission.findMany({
    where: { roleId: user.roleId, allowed: true },
    include: { permission: { select: { key: true } } },
  });
  return rows.map((r) => r.permission.key);
}

export async function loadUserWithRole(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      roleRef: {
        include: {
          permissions: {
            where: { allowed: true },
            include: { permission: { select: { key: true } } },
          },
        },
      },
      student: {
        select: {
          id: true,
          registrationNumber: true,
          fullName: true,
          photo: true,
          status: true,
          mobileNumber: true,
          email: true,
          batch: true,
          fatherName: true,
          motherName: true,
          gender: true,
          dateOfBirth: true,
          address: true,
          city: true,
          state: true,
          joiningDate: true,
          membershipType: true,
          trainingLevel: true,
        },
      },
      coach: {
        select: {
          id: true,
          coachCode: true,
          fullName: true,
          photo: true,
          status: true,
          mobile: true,
          email: true,
          specialization: true,
          fatherName: true,
          joiningDate: true,
          experienceYears: true,
          qualification: true,
        },
      },
      parentProfile: {
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          relation: true,
          photo: true,
        },
      },
    },
  });
}

export async function loadAuthContext(userId) {
  const cached = authContextCache.get(userId);
  if (cached && Date.now() - cached.at < AUTH_CONTEXT_TTL_MS) {
    return { user: cached.user, permissions: cached.permissions };
  }
  const user = await loadUserWithRole(userId);
  if (!user) return { user: null, permissions: [] };
  const permissions = await getUserPermissions(user);
  rememberAuthContext(user, permissions);
  return { user, permissions };
}

export function rememberAuthContext(user, permissions = []) {
  if (!user?.id) return;
  authContextCache.set(user.id, { at: Date.now(), user, permissions });
}
