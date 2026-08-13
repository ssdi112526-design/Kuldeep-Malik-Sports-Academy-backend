import { Router } from 'express';
import {
  protect,
  requireAdminAccess,
  requireAnyPermission,
} from '../middleware/auth.js';
import { modulePermissionKeys } from '../constants/permissions.js';
import * as ctrl from '../controllers/reportsController.js';

const router = Router();

const reportsOr = (...menus) => [
  protect,
  requireAdminAccess,
  requireAnyPermission(
    'reports.view',
    ...menus.flatMap((m) => modulePermissionKeys(m).filter((k) => k.endsWith('.view')))
  ),
];

const financeView = [
  protect,
  requireAdminAccess,
  requireAnyPermission('finance.view'),
];
const sponsorshipView = [
  protect,
  requireAdminAccess,
  requireAnyPermission('sponsorships.view', 'reports.view'),
];

function exportGuard(req, res, next) {
  const key = String(req.params.reportKey || '');
  if (key === 'pending-fees' || key === 'salary') {
    return requireAnyPermission('finance.export', 'reports.export')(req, res, next);
  }
  if (key === 'sponsorships') {
    return requireAnyPermission('sponsorships.export', 'reports.export')(req, res, next);
  }
  return requireAnyPermission(
    'reports.export',
    'students.export',
    'attendance.export',
    'tournaments.export',
    'coaches.export'
  )(req, res, next);
}

router.get('/admin/reports/dashboard', ...reportsOr('students', 'attendance', 'finance'), ctrl.reportsDashboard);
router.get('/admin/reports/players', ...reportsOr('students'), ctrl.playersReport);
router.get('/admin/reports/khelo-india', ...reportsOr('students'), ctrl.kheloIndiaReport);
router.get(
  '/admin/reports/attendance/dashboard',
  ...reportsOr('attendance'),
  ctrl.attendanceDashboardReport
);
router.get(
  '/admin/reports/attendance/monthly',
  ...reportsOr('attendance'),
  ctrl.monthlyAttendanceReport
);
router.get(
  '/admin/reports/attendance/employees',
  ...reportsOr('attendance', 'coaches'),
  ctrl.employeeAttendanceReport
);
router.get('/admin/reports/categories/age', ...reportsOr('students'), ctrl.ageCategoryReport);
router.get('/admin/reports/categories/player', ...reportsOr('students'), ctrl.playerCategoryReport);
router.get('/admin/reports/categories/weight', ...reportsOr('students'), ctrl.weightCategoryReport);
router.get('/admin/reports/tournaments', ...reportsOr('tournaments'), ctrl.tournamentsReport);
router.get(
  '/admin/reports/medals',
  ...reportsOr('tournaments', 'player_achievements'),
  ctrl.medalsReport
);
router.get('/admin/reports/fees/pending', ...financeView, ctrl.pendingFeesReport);
router.get('/admin/reports/salary', ...financeView, ctrl.salaryReport);
router.get('/admin/reports/sponsorships', ...sponsorshipView, ctrl.sponsorshipDocumentsReport);

router.post(
  '/admin/reports/export/:reportKey',
  protect,
  requireAdminAccess,
  exportGuard,
  ctrl.exportReport
);

export default router;
