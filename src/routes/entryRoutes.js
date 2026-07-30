import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { handleMulterError, uploadStudentEntry, uploadCoachEntry, uploadEquipmentEntry } from '../middleware/upload.js';
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
  listEquipmentAdmin,
  getEquipmentById,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  getEquipmentStats,
  exportEquipment,
} from '../controllers/entryController.js';

const router = Router();
const admin = [protect, authorize('admin')];

const runUpload = (uploader) => (req, res, next) => {
  uploader(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
  });
};

// ---------------------------
// Students
// ---------------------------
router.get('/admin/students', ...admin, listStudentsAdmin);
router.get('/admin/students/stats', ...admin, getStudentStats);
router.get('/admin/students/:id', ...admin, getStudentById);
router.post('/admin/students/export', ...admin, exportStudents);
router.post('/admin/students', ...admin, runUpload(uploadStudentEntry), createStudent);
router.put('/admin/students/:id', ...admin, runUpload(uploadStudentEntry), updateStudent);
router.delete('/admin/students/:id', ...admin, deleteStudent);

// ---------------------------
// Coaches
// ---------------------------
router.get('/admin/coaches', ...admin, listCoachesAdmin);
router.get('/admin/coaches/stats', ...admin, getCoachStats);
router.post('/admin/coaches/export', ...admin, exportCoaches);
router.get('/admin/coaches/:id', ...admin, getCoachById);
router.post('/admin/coaches', ...admin, runUpload(uploadCoachEntry), createCoach);
router.put('/admin/coaches/:id', ...admin, runUpload(uploadCoachEntry), updateCoach);
router.delete('/admin/coaches/:id', ...admin, deleteCoach);

// ---------------------------
// Equipment / Tools
// ---------------------------
router.get('/admin/equipment', ...admin, listEquipmentAdmin);
router.get('/admin/equipment/stats', ...admin, getEquipmentStats);
router.post('/admin/equipment/export', ...admin, exportEquipment);
router.get('/admin/equipment/:id', ...admin, getEquipmentById);
router.post('/admin/equipment', ...admin, runUpload(uploadEquipmentEntry), createEquipment);
router.put('/admin/equipment/:id', ...admin, runUpload(uploadEquipmentEntry), updateEquipment);
router.delete('/admin/equipment/:id', ...admin, deleteEquipment);

export default router;

