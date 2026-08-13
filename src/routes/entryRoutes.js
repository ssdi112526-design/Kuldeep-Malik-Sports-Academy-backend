import { Router } from 'express';
import {
  protect,
  requirePermission,
  requireAnyPermission,
  requireAdminAccess,
} from '../middleware/auth.js';
import {
  uploadStudentEntry,
  uploadCoachEntry,
  uploadEquipmentEntry,
  withMediaBlobBackup,
} from '../middleware/upload.js';
import { modulePermissionKeys } from '../constants/permissions.js';
import {
  listStudentsAdmin,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  getStudentStats,
  exportStudents,
  listCoachesPublic,
  listCoachesAdmin,
  getCoachById,
  createCoach,
  updateCoach,
  deleteCoach,
  getCoachStats,
  exportCoaches,
  resetCoachPassword,
  resetStudentPassword,
  listEquipmentAdmin,
  listEquipmentPublic,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getEquipmentStats,
  exportEquipment,
} from '../controllers/entryController.js';
import { globalSearch, globalSearchValidation } from '../controllers/globalSearchController.js';
import validate from '../middleware/validate.js';

const router = Router();

const runUpload = (uploader) => withMediaBlobBackup(uploader);

const studentsRead = [
  protect,
  requireAdminAccess,
  requireAnyPermission(...modulePermissionKeys('students')),
];
const coachesRead = [
  protect,
  requireAdminAccess,
  requireAnyPermission(...modulePermissionKeys('coaches')),
];
const equipmentRead = [
  protect,
  requireAdminAccess,
  requireAnyPermission(...modulePermissionKeys('equipment')),
];

const globalSearchRead = [
  protect,
  requireAdminAccess,
  requireAnyPermission(
    ...modulePermissionKeys('students'),
    ...modulePermissionKeys('coaches'),
    ...modulePermissionKeys('player_achievements'),
    ...modulePermissionKeys('achievements'),
    ...modulePermissionKeys('tournaments'),
    ...modulePermissionKeys('dashboard')
  ),
];

// ---------------------------
// Global Search (Admin)
// ---------------------------
router.get(
  '/admin/global-search',
  ...globalSearchRead,
  ...globalSearchValidation,
  validate,
  globalSearch
);

// ---------------------------
// Students
// ---------------------------
router.get('/admin/students', ...studentsRead, listStudentsAdmin);
router.get('/admin/students/stats', ...studentsRead, getStudentStats);
router.get('/admin/students/:id', ...studentsRead, getStudentById);
router.post(
  '/admin/students/export',
  protect,
  requireAdminAccess,
  requirePermission('students.export'),
  exportStudents
);
router.post(
  '/admin/students',
  protect,
  requireAdminAccess,
  requirePermission('students.create'),
  runUpload(uploadStudentEntry),
  createStudent
);
router.put(
  '/admin/students/:id',
  protect,
  requireAdminAccess,
  requirePermission('students.edit'),
  runUpload(uploadStudentEntry),
  updateStudent
);
router.post(
  '/admin/students/:id/reset-password',
  protect,
  requireAdminAccess,
  requireAnyPermission('students.reset_password', 'students.edit'),
  resetStudentPassword
);
router.delete(
  '/admin/students/:id',
  protect,
  requireAdminAccess,
  requirePermission('students.delete'),
  deleteStudent
);

// ---------------------------
// Coaches
// ---------------------------
router.get('/coaches', listCoachesPublic);
router.get('/admin/coaches', ...coachesRead, listCoachesAdmin);
router.get('/admin/coaches/stats', ...coachesRead, getCoachStats);
router.post(
  '/admin/coaches/export',
  protect,
  requireAdminAccess,
  requirePermission('coaches.export'),
  exportCoaches
);
router.get('/admin/coaches/:id', ...coachesRead, getCoachById);
router.post(
  '/admin/coaches',
  protect,
  requireAdminAccess,
  requirePermission('coaches.create'),
  runUpload(uploadCoachEntry),
  createCoach
);
router.put(
  '/admin/coaches/:id',
  protect,
  requireAdminAccess,
  requirePermission('coaches.edit'),
  runUpload(uploadCoachEntry),
  updateCoach
);
router.post(
  '/admin/coaches/:id/reset-password',
  protect,
  requireAdminAccess,
  requireAnyPermission('coaches.reset_password', 'coaches.edit'),
  resetCoachPassword
);
router.delete(
  '/admin/coaches/:id',
  protect,
  requireAdminAccess,
  requirePermission('coaches.delete'),
  deleteCoach
);

// ---------------------------
// Equipment / Tools
// ---------------------------
router.get('/public/equipment', listEquipmentPublic);
router.get('/admin/equipment', ...equipmentRead, listEquipmentAdmin);
router.get('/admin/equipment/stats', ...equipmentRead, getEquipmentStats);
router.post(
  '/admin/equipment/export',
  protect,
  requireAdminAccess,
  requirePermission('equipment.export'),
  exportEquipment
);
router.get('/admin/equipment/:id', ...equipmentRead, getEquipmentById);
router.post(
  '/admin/equipment',
  protect,
  requireAdminAccess,
  requirePermission('equipment.create'),
  runUpload(uploadEquipmentEntry),
  createEquipment
);
router.put(
  '/admin/equipment/:id',
  protect,
  requireAdminAccess,
  requirePermission('equipment.edit'),
  runUpload(uploadEquipmentEntry),
  updateEquipment
);
router.delete(
  '/admin/equipment/:id',
  protect,
  requireAdminAccess,
  requirePermission('equipment.delete'),
  deleteEquipment
);

export default router;
