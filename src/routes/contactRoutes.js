import { Router } from 'express';
import {
  createContact,
  getContacts,
  getContactStats,
  getContactById,
  bulkDeleteContacts,
  exportContacts,
  updateContactStatus,
  deleteContact,
} from '../controllers/contactController.js';
import { protect, authorize } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { contactValidation } from '../validators/authValidators.js';
import {
  listQueryValidation,
  exportValidation,
  bulkDeleteValidation,
} from '../validators/contactAdminValidators.js';

const router = Router();

router.post('/', contactValidation, validate, createContact);
router.get('/', protect, authorize('admin'), listQueryValidation, validate, getContacts);
router.get('/stats', protect, authorize('admin'), getContactStats);
router.post('/export', protect, authorize('admin'), exportValidation, validate, exportContacts);
router.post(
  '/bulk-delete',
  protect,
  authorize('admin'),
  bulkDeleteValidation,
  validate,
  bulkDeleteContacts
);
router.get('/:id', protect, authorize('admin'), getContactById);
router.patch('/:id/status', protect, authorize('admin'), updateContactStatus);
router.delete('/:id', protect, authorize('admin'), deleteContact);

export default router;
