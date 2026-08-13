import { Router } from 'express';
import { protect, requireAdminAccess, authorize } from '../middleware/auth.js';
import { mediaRestore, mediaStatus } from '../controllers/mediaRestoreController.js';

const router = Router();

/** Super-admin / admin-only media recovery utility (not public). */
const adminOnly = [protect, requireAdminAccess, authorize('admin')];

router.get('/admin/media/status', ...adminOnly, mediaStatus);
router.post('/admin/media/restore', ...adminOnly, mediaRestore);

export default router;
