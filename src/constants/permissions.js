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
  { menu: 'students', label: 'Students', actions: ['view', 'create', 'edit', 'delete', 'export', 'import', 'upload', 'print'] },
  { menu: 'coaches', label: 'Coaches', actions: ['view', 'create', 'edit', 'delete', 'export', 'upload'] },
  { menu: 'equipment', label: 'Equipment & Tools', actions: ['view', 'create', 'edit', 'delete', 'export', 'upload'] },
  { menu: 'schedule', label: 'Schedule', actions: ['view', 'create', 'edit', 'delete'] },
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
  const coachMenus = ['dashboard', 'students', 'schedule', 'achievements', 'videos', 'gallery'];
  const coach = allKeys.filter((k) => coachMenus.some((m) => k.startsWith(`${m}.`)));

  const managerMenus = ['dashboard', 'programs', 'gallery', 'facilities', 'videos', 'students'];
  const manager = allKeys.filter((k) => managerMenus.some((m) => k.startsWith(`${m}.`)));

  const receptionMenus = ['students', 'inquiries', 'dashboard'];
  const reception = allKeys.filter((k) => receptionMenus.some((m) => k.startsWith(`${m}.`)));

  const accountantMenus = ['dashboard', 'students'];
  const accountant = allKeys.filter(
    (k) =>
      accountantMenus.some((m) => k.startsWith(`${m}.`)) &&
      (k.endsWith('.view') || k.endsWith('.export') || k.endsWith('.print') || k.endsWith('.download'))
  );

  // Staff: view-only — must not include create/edit/delete
  const staff = allKeys.filter((k) => k.endsWith('.view'));

  return {
    super_admin: superAdmin,
    admin,
    coach,
    manager,
    reception,
    accountant,
    staff,
  };
}

/** All permission keys for a module (for list/read OR checks). */
export function modulePermissionKeys(menu) {
  const def = MENU_DEFINITIONS.find((m) => m.menu === menu);
  if (!def) return [`${menu}.view`];
  return def.actions.map((action) => `${menu}.${action}`);
}

export const SYSTEM_ROLES = [
  { name: 'Super Admin', slug: 'super_admin', description: 'Full system access including users and roles.', isSystem: true },
  { name: 'Admin', slug: 'admin', description: 'Full content and operations access except user/role management.', isSystem: true },
  { name: 'Coach', slug: 'coach', description: 'Students, schedule, achievements, videos and gallery.', isSystem: true },
  { name: 'Manager', slug: 'manager', description: 'Programs, content and students.', isSystem: true },
  { name: 'Reception', slug: 'reception', description: 'Students and inquiries desk.', isSystem: true },
  { name: 'Accountant', slug: 'accountant', description: 'Dashboard and student record views.', isSystem: true },
  { name: 'Staff', slug: 'staff', description: 'View-only access across allowed modules.', isSystem: true },
];
