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
import { protect, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { contactValidation } from '../validators/authValidators.js';
import {
  listQueryValidation,
  exportValidation,
  bulkDeleteValidation,
} from '../validators/contactAdminValidators.js';
import { modulePermissionKeys } from '../constants/permissions.js';

const router = Router();

const inquiriesRead = [protect, requireAnyPermission(...modulePermissionKeys('inquiries'))];

router.post('/', contactValidation, validate, createContact);
router.get('/', ...inquiriesRead, listQueryValidation, validate, getContacts);
router.get('/stats', ...inquiriesRead, getContactStats);
router.post('/export', protect, requirePermission('inquiries.export'), exportValidation, validate, exportContacts);
router.post(
  '/bulk-delete',
  protect,
  requirePermission('inquiries.delete'),
  bulkDeleteValidation,
  validate,
  bulkDeleteContacts
);
router.get('/:id', ...inquiriesRead, getContactById);
router.patch('/:id/status', protect, requirePermission('inquiries.edit'), updateContactStatus);
router.delete('/:id', protect, requirePermission('inquiries.delete'), deleteContact);

export default router;
