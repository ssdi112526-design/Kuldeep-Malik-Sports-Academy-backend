/** Canonical permission catalog for Raghunandan Akhada admin RBAC */

export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'publish',
  'approve',
  'export',
  'import',
  'upload',
  'download',
  'print',
  'manage_settings',
];

/** Menus removed from Role Management (kept here only for DB cleanup) */
export const REMOVED_ROLE_MENUS = [
  'testimonials',
  'website_settings',
  'hero',
  'membership',
  'contact',
  'language',
  'reports',
  'backup',
  'system_settings',
];

export const MENU_DEFINITIONS = [
  { menu: 'dashboard', label: 'Dashboard', actions: ['view'] },
  { menu: 'inquiries', label: 'Inquiries', actions: ['view', 'edit', 'delete', 'export'] },
  { menu: 'programs', label: 'Programs', actions: ['view', 'create', 'edit', 'delete', 'upload'] },
  { menu: 'gallery', label: 'Gallery', actions: ['view', 'create', 'edit', 'delete', 'upload', 'download', 'publish'] },
  { menu: 'facilities', label: 'Facilities', actions: ['view', 'create', 'edit', 'delete', 'upload'] },
  { menu: 'videos', label: 'Videos', actions: ['view', 'create', 'edit', 'delete', 'upload', 'publish'] },
  { menu: 'students', label: 'Students', actions: ['view', 'create', 'edit', 'delete', 'export', 'import', 'upload', 'print', 'reset_password'] },
  { menu: 'coaches', label: 'Coaches', actions: ['view', 'create', 'edit', 'delete', 'export', 'upload', 'reset_password'] },
  { menu: 'equipment', label: 'Equipment & Tools', actions: ['view', 'create', 'edit', 'delete', 'export', 'upload'] },
  { menu: 'schedule', label: 'Schedule', actions: ['view', 'create', 'edit', 'delete'] },
  { menu: 'attendance', label: 'Attendance', actions: ['view', 'create', 'edit', 'export'] },
  { menu: 'finance', label: 'Finance', actions: ['view', 'create', 'edit', 'delete', 'export', 'print', 'download'] },
  { menu: 'achievements', label: 'Achievements', actions: ['view', 'create', 'edit', 'delete'] },
  { menu: 'users', label: 'Users', actions: ['view', 'create', 'edit', 'delete', 'export'] },
  { menu: 'roles', label: 'Roles', actions: ['view', 'create', 'edit', 'delete', 'manage_settings'] },
];

export function buildPermissionCatalog() {
  const list = [];
  for (const def of MENU_DEFINITIONS) {
    for (const action of def.actions) {
      list.push({
        menu: def.menu,
        action,
        key: `${def.menu}.${action}`,
        label: `${def.label} · ${action.replace(/_/g, ' ')}`,
      });
    }
  }
  return list;
}

/** Role presets: which permission keys each system role gets */
export function getSystemRolePermissionKeys(allKeys) {
  const superAdmin = [...allKeys];

  const adminDeniedPrefixes = ['users.', 'roles.'];
  const admin = allKeys.filter((k) => !adminDeniedPrefixes.some((p) => k.startsWith(p)));

  // Coach / manager / reception get full action sets for their menus (system defaults).
  // Custom roles still store exact checkbox state with no inheritance.
  const coachMenus = ['dashboard', 'students', 'schedule', 'attendance', 'achievements', 'videos', 'gallery'];
  const coach = allKeys.filter((k) => coachMenus.some((m) => k.startsWith(`${m}.`)));

  const managerMenus = ['dashboard', 'programs', 'gallery', 'facilities', 'videos', 'students', 'attendance'];
  const manager = allKeys.filter((k) => managerMenus.some((m) => k.startsWith(`${m}.`)));

  const receptionMenus = ['students', 'inquiries', 'dashboard', 'attendance', 'finance'];
  const reception = allKeys.filter((k) => receptionMenus.some((m) => k.startsWith(`${m}.`)));

  const accountantMenus = ['dashboard', 'students', 'finance'];
  const accountant = allKeys.filter(
    (k) =>
      accountantMenus.some((m) => k.startsWith(`${m}.`)) &&
      (k.endsWith('.view') ||
        k.endsWith('.export') ||
        k.endsWith('.print') ||
        k.endsWith('.download') ||
        k.endsWith('.create') ||
        k.endsWith('.edit'))
  );

  // Staff: view-only — must not include create/edit/delete
  const staff = allKeys.filter((k) => k.endsWith('.view'));

  // Student / coach portal roles — no admin permissions
  return {
    super_admin: superAdmin,
    admin,
    coach,
    manager,
    reception,
    accountant,
    staff,
    student: [],
    coach_portal: [],
  };
}

export const LOW_ATTENDANCE_THRESHOLD = Number(process.env.LOW_ATTENDANCE_THRESHOLD || 75);

/** All permission keys for a module (for list/read OR checks). */
export function modulePermissionKeys(menu) {
  const def = MENU_DEFINITIONS.find((m) => m.menu === menu);
  if (!def) return [`${menu}.view`];
  return def.actions.map((action) => `${menu}.${action}`);
}

export const SYSTEM_ROLES = [
  { name: 'Super Admin', slug: 'super_admin', description: 'Full system access including users and roles.', isSystem: true },
  { name: 'Admin', slug: 'admin', description: 'Full content and operations access except user/role management.', isSystem: true },
  { name: 'Coach', slug: 'coach', description: 'Students, schedule, attendance, achievements, videos and gallery.', isSystem: true },
  { name: 'Manager', slug: 'manager', description: 'Programs, content, students and attendance.', isSystem: true },
  { name: 'Reception', slug: 'reception', description: 'Students, inquiries and attendance desk.', isSystem: true },
  { name: 'Accountant', slug: 'accountant', description: 'Finance, fees collection and student fee views.', isSystem: true },
  { name: 'Staff', slug: 'staff', description: 'View-only access across allowed modules.', isSystem: true },
  { name: 'Student', slug: 'student', description: 'Student portal only — profile, QR scan and own attendance.', isSystem: true },
  { name: 'Coach Portal', slug: 'coach_portal', description: 'Coach user panel only — profile, own attendance and account.', isSystem: true },
];
