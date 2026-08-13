import { Router } from 'express';
import {
  protect,
  requireAdminAccess,
  requireAnyPermission,
  requireParent,
  requirePermission,
  requireStudent,
} from '../middleware/auth.js';
import { modulePermissionKeys } from '../constants/permissions.js';
import validate from '../middleware/validate.js';
import { uploadSingle, withMediaBlobBackup } from '../middleware/upload.js';

const runUpload = withMediaBlobBackup(uploadSingle);
import {
  listPlayerAchievements,
  listPlayerAchievementsPublic,
  createPlayerAchievement,
  updatePlayerAchievement,
  deletePlayerAchievement,
  playerAchievementListValidation,
  playerAchievementWriteValidation,
  playerAchievementIdValidation,
  listTournaments,
  createTournament,
  updateTournament,
  deleteTournament,
  tournamentWriteValidation,
  tournamentResultWriteValidation,
  upsertTournamentResult,
  deleteTournamentResult,
  createParentAccount,
  createParentAccountValidation,
  listParents,
  parentDashboard,
  parentChildAttendance,
  parentChildAchievements,
  parentChildTournaments,
  myPlayerAchievements,
  myPlayerTournaments,
} from '../controllers/academyRecordsController.js';

const router = Router();

const achRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('player_achievements'), ...modulePermissionKeys('achievements'))];
const achWrite = [protect, requireAdminAccess, requirePermission('player_achievements.create')];
const achEdit = [protect, requireAdminAccess, requirePermission('player_achievements.edit')];
const achDelete = [protect, requireAdminAccess, requirePermission('player_achievements.delete')];

const tourRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('tournaments'))];
const tourWrite = [protect, requireAdminAccess, requirePermission('tournaments.create')];
const tourEdit = [protect, requireAdminAccess, requirePermission('tournaments.edit')];
const tourDelete = [protect, requireAdminAccess, requirePermission('tournaments.delete')];

const parentAdmin = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('students'), 'students.create')];

router.get('/public/achievements', listPlayerAchievementsPublic);
router.get('/admin/player-achievements', ...achRead, ...playerAchievementListValidation, validate, listPlayerAchievements);
router.post(
  '/admin/player-achievements',
  ...achWrite,
  runUpload,
  ...playerAchievementWriteValidation,
  validate,
  createPlayerAchievement
);
router.put(
  '/admin/player-achievements/:id',
  ...achEdit,
  ...playerAchievementIdValidation,
  runUpload,
  ...playerAchievementWriteValidation,
  validate,
  updatePlayerAchievement
);
router.delete(
  '/admin/player-achievements/:id',
  ...achDelete,
  ...playerAchievementIdValidation,
  validate,
  deletePlayerAchievement
);

router.get('/admin/tournaments', ...tourRead, listTournaments);
router.post(
  '/admin/tournaments',
  ...tourWrite,
  runUpload,
  ...tournamentWriteValidation,
  validate,
  createTournament
);
router.put(
  '/admin/tournaments/:id',
  ...tourEdit,
  runUpload,
  ...tournamentWriteValidation,
  validate,
  updateTournament
);
router.delete('/admin/tournaments/:id', ...tourDelete, deleteTournament);
router.post(
  '/admin/tournaments/:id/results',
  ...tourEdit,
  runUpload,
  ...tournamentResultWriteValidation,
  validate,
  upsertTournamentResult
);
router.delete('/admin/tournaments/:id/results/:resultId', ...tourDelete, deleteTournamentResult);

router.get('/admin/parents', ...parentAdmin, listParents);
router.post(
  '/admin/parents',
  ...parentAdmin,
  runUpload,
  ...createParentAccountValidation,
  validate,
  createParentAccount
);

router.get('/parent/me', protect, requireParent, parentDashboard);
router.get('/parent/children/:studentId/attendance', protect, requireParent, parentChildAttendance);
router.get('/parent/children/:studentId/achievements', protect, requireParent, parentChildAchievements);
router.get('/parent/children/:studentId/tournaments', protect, requireParent, parentChildTournaments);

router.get('/student/my-achievements', protect, requireStudent, myPlayerAchievements);
router.get('/student/my-tournaments', protect, requireStudent, myPlayerTournaments);

export default router;
