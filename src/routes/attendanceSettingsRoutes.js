import { Router } from 'express';
import { protect, requirePermission, requireAdminAccess } from '../middleware/auth.js';
import {
  getAttendanceSettings,
  updateAttendanceSettings,
  testAttendanceLocation,
  previewDistance,
  getPublicAkhadaLocation,
} from '../controllers/attendanceSettingsController.js';

const router = Router();

const adminView = [protect, requireAdminAccess, requirePermission('attendance.view')];
const adminEdit = [protect, requireAdminAccess, requirePermission('attendance.edit')];

router.get('/public/akhada-location', getPublicAkhadaLocation);
router.get('/admin/attendance/settings', ...adminView, getAttendanceSettings);
router.put('/admin/attendance/settings', ...adminEdit, updateAttendanceSettings);
router.post('/admin/attendance/settings/test', ...adminEdit, testAttendanceLocation);
router.get('/admin/attendance/settings/distance', ...adminView, previewDistance);

export default router;
