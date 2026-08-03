import { Router } from 'express';
import { protect, requirePermission, requireAdminAccess, requireAnyPermission } from '../middleware/auth.js';
import { modulePermissionKeys } from '../constants/permissions.js';
import {
  listBiometricDevices,
  getBiometricDevice,
  createBiometricDevice,
  updateBiometricDevice,
  deleteBiometricDevice,
  testBiometricDevice,
  syncBiometricDeviceNow,
  listBiometricDeviceLogs,
  listUnknownBiometricLogs,
  ingestBiometricEvents,
  setStudentBiometricId,
  setCoachBiometricId,
} from '../controllers/biometricController.js';

const router = Router();

const attView = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('attendance'))];
const attCreate = [protect, requireAdminAccess, requirePermission('attendance.create')];
const attEdit = [protect, requireAdminAccess, requirePermission('attendance.edit')];

// Public to authorized devices (no admin JWT) — secured by device secret
router.post('/biometric/ingest', ingestBiometricEvents);

router.get('/admin/biometric/devices', ...attView, listBiometricDevices);
router.get('/admin/biometric/unknown-logs', ...attView, listUnknownBiometricLogs);
router.get('/admin/biometric/devices/:id', ...attView, getBiometricDevice);
router.post('/admin/biometric/devices', ...attCreate, createBiometricDevice);
router.put('/admin/biometric/devices/:id', ...attEdit, updateBiometricDevice);
router.delete('/admin/biometric/devices/:id', protect, requireAdminAccess, requirePermission('attendance.edit'), deleteBiometricDevice);
router.post('/admin/biometric/devices/:id/test', ...attEdit, testBiometricDevice);
router.post('/admin/biometric/devices/:id/sync', ...attEdit, syncBiometricDeviceNow);
router.get('/admin/biometric/devices/:id/logs', ...attView, listBiometricDeviceLogs);

router.put('/admin/students/:id/biometric', protect, requireAdminAccess, requirePermission('students.edit'), setStudentBiometricId);
router.put('/admin/coaches/:id/biometric', protect, requireAdminAccess, requirePermission('coaches.edit'), setCoachBiometricId);

export default router;
