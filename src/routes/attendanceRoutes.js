import { Router } from 'express';
import { protect, requirePermission, requireAnyPermission, requireStudent, requireAdminAccess } from '../middleware/auth.js';
import {
  generateAttendanceQr,
  getActiveAttendanceQr,
  closeAttendanceQr,
  listAttendanceSessions,
  getAttendanceStats,
  listAttendanceRecords,
  listAvailableAttendanceMonths,
  getStudentAttendanceSummary,
  getAttendanceRecord,
  exportAttendanceExcel,
  listDailyRoster,
  getStudentHistory,
  scanAttendance,
  markAttendanceStatus,
  getMyAttendance,
  getMyStudentProfile,
} from '../controllers/attendanceController.js';

const router = Router();

const adminView = [protect, requireAdminAccess, requirePermission('attendance.view')];
const studentHistoryView = [
  protect,
  requireAdminAccess,
  requireAnyPermission('attendance.view', 'reports.view', 'students.view'),
];
const adminCreate = [protect, requireAdminAccess, requirePermission('attendance.create')];
const adminEdit = [protect, requireAdminAccess, requirePermission('attendance.edit')];
const adminExport = [protect, requireAdminAccess, requirePermission('attendance.export')];

router.get('/admin/attendance/stats', ...adminView, getAttendanceStats);
router.get('/admin/attendance/months', ...adminView, listAvailableAttendanceMonths);
router.get('/admin/attendance/records', ...adminView, listAttendanceRecords);
router.get('/admin/attendance/roster', ...adminView, listDailyRoster);
router.get('/admin/attendance/summary/students', ...adminView, getStudentAttendanceSummary);
router.get('/admin/attendance/students/:studentId/history', ...studentHistoryView, getStudentHistory);
router.get('/admin/attendance/records/:id', ...adminView, getAttendanceRecord);
router.get('/admin/attendance/sessions', ...adminView, listAttendanceSessions);
router.get('/admin/attendance/qr/active', ...adminView, getActiveAttendanceQr);
router.post('/admin/attendance/qr/generate', ...adminCreate, generateAttendanceQr);
router.post('/admin/attendance/qr/close', ...adminEdit, closeAttendanceQr);
router.post('/admin/attendance/qr/:id/close', ...adminEdit, closeAttendanceQr);
router.post('/admin/attendance/mark', ...adminEdit, markAttendanceStatus);
router.post('/admin/attendance/export', ...adminExport, exportAttendanceExcel);

router.get('/student/profile', protect, requireStudent, getMyStudentProfile);
router.get('/student/attendance', protect, requireStudent, getMyAttendance);
router.post('/student/attendance/scan', protect, requireStudent, scanAttendance);

export default router;
