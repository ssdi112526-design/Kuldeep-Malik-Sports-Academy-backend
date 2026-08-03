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
          : user.role === 'user'
            ? 'staff'
            : user.role);

  const isStudent = user.role === 'student' || roleSlug === 'student' || Boolean(user.studentId);
  // Portal coach (linked Coach entity) — not the admin-panel staff role slug "coach"
  const isCoach =
    Boolean(user.coachId) ||
    user.role === 'coach' ||
    roleSlug === 'coach_portal';
  const isPortalUser = isStudent || isCoach;

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

  let roleName = roleRef?.name || 'User';
  if (!roleRef) {
    if (rest.role === 'admin') roleName = 'Super Admin';
    else if (rest.role === 'student') roleName = 'Student';
    else if (rest.role === 'coach') roleName = 'Coach';
  }

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
    accountType,
    isStudent,
    isCoach,
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

export async function getUserPermissions(user) {
  if (!user) return [];

  if (user.role === 'student' || user.studentId || user.role === 'coach' || user.coachId) {
    return [];
  }

  // Legacy admin without RBAC role → full access
  if (user.role === 'admin' && !user.roleId) {
    const all = await prisma.permission.findMany({ select: { key: true } });
    if (all.length) return all.map((p) => p.key);
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
    include: {
      roleRef: true,
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
    },
  });
}
