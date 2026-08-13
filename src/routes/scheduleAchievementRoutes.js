import { Router } from 'express';
import {
  protect,
  requirePermission,
  requireAnyPermission,
  requireAdminAccess,
} from '../middleware/auth.js';
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

const achievementsRead = [
  protect,
  requireAdminAccess,
  requireAnyPermission(...modulePermissionKeys('achievements')),
];
const scheduleRead = [
  protect,
  requireAdminAccess,
  requireAnyPermission(...modulePermissionKeys('schedule')),
];

/* Public */
router.get('/achievements', listAchievementsPublic);
router.get('/schedule', listSchedulePublic);

/* Admin Achievements */
router.get('/admin/achievements', ...achievementsRead, ...listValidation, validate, listAchievementsAdmin);
router.post(
  '/admin/achievements',
  protect,
  requireAdminAccess,
  requirePermission('achievements.create'),
  createAchievement
);
router.put(
  '/admin/achievements/:id',
  protect,
  requireAdminAccess,
  requirePermission('achievements.edit'),
  ...idParamValidation,
  validate,
  updateAchievement
);
router.delete(
  '/admin/achievements/:id',
  protect,
  requireAdminAccess,
  requirePermission('achievements.delete'),
  ...idParamValidation,
  validate,
  deleteAchievement
);

/* Admin Schedule sessions */
router.get('/admin/schedule/sessions', ...scheduleRead, ...listValidation, validate, listScheduleSessionsAdmin);
router.post(
  '/admin/schedule/sessions',
  protect,
  requireAdminAccess,
  requirePermission('schedule.create'),
  createScheduleSession
);
router.put(
  '/admin/schedule/sessions/:id',
  protect,
  requireAdminAccess,
  requirePermission('schedule.edit'),
  ...idParamValidation,
  validate,
  updateScheduleSession
);
router.delete(
  '/admin/schedule/sessions/:id',
  protect,
  requireAdminAccess,
  requirePermission('schedule.delete'),
  ...idParamValidation,
  validate,
  deleteScheduleSession
);

/* Admin Schedule days */
router.get('/admin/schedule/days', ...scheduleRead, ...listValidation, validate, listScheduleDaysAdmin);
router.post(
  '/admin/schedule/days',
  protect,
  requireAdminAccess,
  requirePermission('schedule.create'),
  createScheduleDay
);
router.put(
  '/admin/schedule/days/:id',
  protect,
  requireAdminAccess,
  requirePermission('schedule.edit'),
  ...idParamValidation,
  validate,
  updateScheduleDay
);
router.delete(
  '/admin/schedule/days/:id',
  protect,
  requireAdminAccess,
  requirePermission('schedule.delete'),
  ...idParamValidation,
  validate,
  deleteScheduleDay
);

export default router;
