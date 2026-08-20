import { Router } from 'express';
import { protect, requirePermission, requireAdminAccess } from '../middleware/auth.js';
import {
  getCoachAttendanceStats,
  listCoachAttendanceMonths,
  listCoachAttendanceRecords,
  getCoachAttendanceSummaryList,
  getCoachHistory,
  exportCoachAttendanceExcel,
  listCoachDailyRoster,
  markCoachAttendanceStatus,
} from '../controllers/coachAttendanceController.js';

const router = Router();

const adminView = [protect, requireAdminAccess, requirePermission('attendance.view')];
const adminEdit = [protect, requireAdminAccess, requirePermission('attendance.edit')];
const adminExport = [protect, requireAdminAccess, requirePermission('attendance.export')];

router.get('/admin/coach-attendance/stats', ...adminView, getCoachAttendanceStats);
router.get('/admin/coach-attendance/months', ...adminView, listCoachAttendanceMonths);
router.get('/admin/coach-attendance/records', ...adminView, listCoachAttendanceRecords);
router.get('/admin/coach-attendance/roster', ...adminView, listCoachDailyRoster);
router.get('/admin/coach-attendance/summary/coaches', ...adminView, getCoachAttendanceSummaryList);
router.get('/admin/coach-attendance/coaches/:coachId/history', ...adminView, getCoachHistory);
router.post('/admin/coach-attendance/mark', ...adminEdit, markCoachAttendanceStatus);
router.post('/admin/coach-attendance/export', ...adminExport, exportCoachAttendanceExcel);

export default router;
