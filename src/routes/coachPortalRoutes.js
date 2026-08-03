import { Router } from 'express';
import { protect, requireCoach } from '../middleware/auth.js';
import { getMyCoachProfile, getMyCoachAttendance } from '../controllers/coachPortalController.js';

const router = Router();

router.get('/coach/profile', protect, requireCoach, getMyCoachProfile);
router.get('/coach/attendance', protect, requireCoach, getMyCoachAttendance);

export default router;
