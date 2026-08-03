import { Router } from 'express';
import { protect, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { handleMulterError, uploadStudentEntry, uploadCoachEntry, uploadEquipmentEntry } from '../middleware/upload.js';
import { modulePermissionKeys } from '../constants/permissions.js';
import {
  listStudentsAdmin,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  getStudentStats,
  exportStudents,
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
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getEquipmentStats,
  exportEquipment,
} from '../controllers/entryController.js';

const router = Router();

const runUpload = (uploader) => (req, res, next) => {
  uploader(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
  });
};

const studentsRead = [protect, requireAnyPermission(...modulePermissionKeys('students'))];
const coachesRead = [protect, requireAnyPermission(...modulePermissionKeys('coaches'))];
const equipmentRead = [protect, requireAnyPermission(...modulePermissionKeys('equipment'))];

// ---------------------------
// Students
// ---------------------------
router.get('/admin/students', ...studentsRead, listStudentsAdmin);
router.get('/admin/students/stats', ...studentsRead, getStudentStats);
router.get('/admin/students/:id', ...studentsRead, getStudentById);
router.post('/admin/students/export', protect, requirePermission('students.export'), exportStudents);
router.post('/admin/students', protect, requirePermission('students.create'), runUpload(uploadStudentEntry), createStudent);
router.put('/admin/students/:id', protect, requirePermission('students.edit'), runUpload(uploadStudentEntry), updateStudent);
router.post(
  '/admin/students/:id/reset-password',
  protect,
  requireAnyPermission('students.reset_password', 'students.edit'),
  resetStudentPassword
);
router.delete('/admin/students/:id', protect, requirePermission('students.delete'), deleteStudent);

// ---------------------------
// Coaches
// ---------------------------
router.get('/admin/coaches', ...coachesRead, listCoachesAdmin);
router.get('/admin/coaches/stats', ...coachesRead, getCoachStats);
router.post('/admin/coaches/export', protect, requirePermission('coaches.export'), exportCoaches);
router.get('/admin/coaches/:id', ...coachesRead, getCoachById);
router.post('/admin/coaches', protect, requirePermission('coaches.create'), runUpload(uploadCoachEntry), createCoach);
router.put('/admin/coaches/:id', protect, requirePermission('coaches.edit'), runUpload(uploadCoachEntry), updateCoach);
router.post(
  '/admin/coaches/:id/reset-password',
  protect,
  requireAnyPermission('coaches.reset_password', 'coaches.edit'),
  resetCoachPassword
);
router.delete('/admin/coaches/:id', protect, requirePermission('coaches.delete'), deleteCoach);

// ---------------------------
// Equipment / Tools
// ---------------------------
router.get('/admin/equipment', ...equipmentRead, listEquipmentAdmin);
router.get('/admin/equipment/stats', ...equipmentRead, getEquipmentStats);
router.post('/admin/equipment/export', protect, requirePermission('equipment.export'), exportEquipment);
router.get('/admin/equipment/:id', ...equipmentRead, getEquipmentById);
router.post('/admin/equipment', protect, requirePermission('equipment.create'), runUpload(uploadEquipmentEntry), createEquipment);
router.put('/admin/equipment/:id', protect, requirePermission('equipment.edit'), runUpload(uploadEquipmentEntry), updateEquipment);
router.delete('/admin/equipment/:id', protect, requirePermission('equipment.delete'), deleteEquipment);

export default router;
