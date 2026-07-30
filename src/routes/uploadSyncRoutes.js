import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { runSyncUpload, syncUploadFile } from '../controllers/uploadSyncController.js';

const router = Router();
const admin = [protect, authorize('admin')];

router.post('/admin/uploads/sync', ...admin, runSyncUpload, syncUploadFile);

export default router;
