import { Router } from 'express';
import { protect, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { modulePermissionKeys } from '../constants/permissions.js';
import {
  listAchievementsPublic,
  listAchievementsAdmin,
  createAchievement,
  updateAchievement,
  deleteAchievement,
  listSchedulePublic,
  listScheduleSessionsAdmin,
  createScheduleSession,
  updateScheduleSession,
  deleteScheduleSession,
  listScheduleDaysAdmin,
  createScheduleDay,
  updateScheduleDay,
  deleteScheduleDay,
  idParamValidation,
  listValidation,
} from '../controllers/scheduleAchievementController.js';

const router = Router();

const achievementsRead = [protect, requireAnyPermission(...modulePermissionKeys('achievements'))];
const scheduleRead = [protect, requireAnyPermission(...modulePermissionKeys('schedule'))];

/* Public */
router.get('/achievements', listAchievementsPublic);
router.get('/schedule', listSchedulePublic);

/* Admin Achievements */
router.get('/admin/achievements', ...achievementsRead, ...listValidation, validate, listAchievementsAdmin);
router.post('/admin/achievements', protect, requirePermission('achievements.create'), createAchievement);
router.put('/admin/achievements/:id', protect, requirePermission('achievements.edit'), ...idParamValidation, validate, updateAchievement);
router.delete('/admin/achievements/:id', protect, requirePermission('achievements.delete'), ...idParamValidation, validate, deleteAchievement);

/* Admin Schedule sessions */
router.get('/admin/schedule/sessions', ...scheduleRead, ...listValidation, validate, listScheduleSessionsAdmin);
router.post('/admin/schedule/sessions', protect, requirePermission('schedule.create'), createScheduleSession);
router.put('/admin/schedule/sessions/:id', protect, requirePermission('schedule.edit'), ...idParamValidation, validate, updateScheduleSession);
router.delete('/admin/schedule/sessions/:id', protect, requirePermission('schedule.delete'), ...idParamValidation, validate, deleteScheduleSession);

/* Admin Schedule days */
router.get('/admin/schedule/days', ...scheduleRead, ...listValidation, validate, listScheduleDaysAdmin);
router.post('/admin/schedule/days', protect, requirePermission('schedule.create'), createScheduleDay);
router.put('/admin/schedule/days/:id', protect, requirePermission('schedule.edit'), ...idParamValidation, validate, updateScheduleDay);
router.delete('/admin/schedule/days/:id', protect, requirePermission('schedule.delete'), ...idParamValidation, validate, deleteScheduleDay);

export default router;
