import { Router } from 'express';
import { protect, requirePermission, requireAdminAccess, requireCoach } from '../middleware/auth.js';
import {
  generateCoachAttendanceQr,
  getActiveCoachAttendanceQr,
  closeCoachAttendanceQr,
  getCoachAttendanceStats,
  listCoachAttendanceMonths,
  listCoachAttendanceRecords,
  getCoachAttendanceSummaryList,
  getCoachHistory,
  exportCoachAttendanceExcel,
  scanCoachAttendance,
} from '../controllers/coachAttendanceController.js';

const router = Router();

const adminView = [protect, requireAdminAccess, requirePermission('attendance.view')];
const adminCreate = [protect, requireAdminAccess, requirePermission('attendance.create')];
const adminEdit = [protect, requireAdminAccess, requirePermission('attendance.edit')];
const adminExport = [protect, requireAdminAccess, requirePermission('attendance.export')];

router.get('/admin/coach-attendance/stats', ...adminView, getCoachAttendanceStats);
router.get('/admin/coach-attendance/months', ...adminView, listCoachAttendanceMonths);
router.get('/admin/coach-attendance/records', ...adminView, listCoachAttendanceRecords);
router.get('/admin/coach-attendance/summary/coaches', ...adminView, getCoachAttendanceSummaryList);
router.get('/admin/coach-attendance/coaches/:coachId/history', ...adminView, getCoachHistory);
router.get('/admin/coach-attendance/qr/active', ...adminView, getActiveCoachAttendanceQr);
router.post('/admin/coach-attendance/qr/generate', ...adminCreate, generateCoachAttendanceQr);
router.post('/admin/coach-attendance/qr/close', ...adminEdit, closeCoachAttendanceQr);
router.post('/admin/coach-attendance/qr/:id/close', ...adminEdit, closeCoachAttendanceQr);
router.post('/admin/coach-attendance/export', ...adminExport, exportCoachAttendanceExcel);

// Coach portal self-scan (JWT coach identity only)
router.post('/coach/attendance/scan', protect, requireCoach, scanCoachAttendance);

export default router;
