import { Router } from 'express';
import { protect, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import {
  uploadSingle,
  uploadMultiple,
  uploadVideoMedia,
  handleMulterError,
} from '../middleware/upload.js';
import { modulePermissionKeys } from '../constants/permissions.js';
import {
  listProgramsPublic,
  listProgramsAdmin,
  createProgram,
  updateProgram,
  deleteProgram,
  programListValidation,
  programCreateValidation,
  programUpdateValidation,
  programIdValidation,
  listGalleryPublic,
  listGalleryAdmin,
  createGalleryItem,
  updateGalleryItem,
  deleteGalleryItem,
  galleryListValidation,
  galleryCreateValidation,
  galleryUpdateValidation,
  galleryIdValidation,
  listFacilitiesPublic,
  listFacilitiesAdmin,
  createFacility,
  updateFacility,
  deleteFacility,
  facilityListValidation,
  facilityCreateValidation,
  facilityUpdateValidation,
  facilityIdValidation,
  getContentStats,
} from '../controllers/cmsController.js';
import {
  listVideosPublic,
  getVideoBySlug,
  listVideosAdmin,
  getVideoStats,
  createVideo,
  updateVideo,
  deleteVideo,
  videoListValidation,
  videoCreateValidation,
  videoUpdateValidation,
  videoIdValidation,
  videoSlugValidation,
} from '../controllers/videoController.js';

const router = Router();

const runUpload = (uploader) => (req, res, next) => {
  uploader(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
  });
};

const programsRead = [protect, requireAnyPermission(...modulePermissionKeys('programs'))];
const galleryRead = [protect, requireAnyPermission(...modulePermissionKeys('gallery'))];
const facilitiesRead = [protect, requireAnyPermission(...modulePermissionKeys('facilities'))];
const videosRead = [protect, requireAnyPermission(...modulePermissionKeys('videos'))];
const dashboardRead = [protect, requireAnyPermission(...modulePermissionKeys('dashboard'), ...modulePermissionKeys('programs'), ...modulePermissionKeys('gallery'), ...modulePermissionKeys('facilities'), ...modulePermissionKeys('videos'))];

/* Public */
router.get('/programs', listProgramsPublic);
router.get('/gallery', listGalleryPublic);
router.get('/facilities', listFacilitiesPublic);
router.get('/videos', listVideosPublic);
router.get('/videos/:slug', ...videoSlugValidation, validate, getVideoBySlug);

/* Admin stats */
router.get('/admin/stats', ...dashboardRead, getContentStats);
router.get('/admin/videos/stats', ...videosRead, getVideoStats);

/* Admin Programs — exact action permissions */
router.get('/admin/programs', ...programsRead, ...programListValidation, validate, listProgramsAdmin);
router.post(
  '/admin/programs',
  protect,
  requirePermission('programs.create'),
  runUpload(uploadSingle),
  ...programCreateValidation,
  validate,
  createProgram
);
router.put(
  '/admin/programs/:id',
  protect,
  requirePermission('programs.edit'),
  runUpload(uploadSingle),
  ...programUpdateValidation,
  validate,
  updateProgram
);
router.delete(
  '/admin/programs/:id',
  protect,
  requirePermission('programs.delete'),
  ...programIdValidation,
  validate,
  deleteProgram
);

/* Admin Gallery */
router.get('/admin/gallery', ...galleryRead, ...galleryListValidation, validate, listGalleryAdmin);
router.post(
  '/admin/gallery',
  protect,
  requirePermission('gallery.create'),
  runUpload(uploadMultiple),
  ...galleryCreateValidation,
  validate,
  createGalleryItem
);
router.put(
  '/admin/gallery/:id',
  protect,
  requirePermission('gallery.edit'),
  runUpload(uploadSingle),
  ...galleryUpdateValidation,
  validate,
  updateGalleryItem
);
router.delete(
  '/admin/gallery/:id',
  protect,
  requirePermission('gallery.delete'),
  ...galleryIdValidation,
  validate,
  deleteGalleryItem
);

/* Admin Facilities */
router.get('/admin/facilities', ...facilitiesRead, ...facilityListValidation, validate, listFacilitiesAdmin);
router.post(
  '/admin/facilities',
  protect,
  requirePermission('facilities.create'),
  runUpload(uploadSingle),
  ...facilityCreateValidation,
  validate,
  createFacility
);
router.put(
  '/admin/facilities/:id',
  protect,
  requirePermission('facilities.edit'),
  runUpload(uploadSingle),
  ...facilityUpdateValidation,
  validate,
  updateFacility
);
router.delete(
  '/admin/facilities/:id',
  protect,
  requirePermission('facilities.delete'),
  ...facilityIdValidation,
  validate,
  deleteFacility
);

/* Admin Videos */
router.get('/admin/videos', ...videosRead, ...videoListValidation, validate, listVideosAdmin);
router.post(
  '/admin/videos',
  protect,
  requirePermission('videos.create'),
  runUpload(uploadVideoMedia),
  ...videoCreateValidation,
  validate,
  createVideo
);
router.put(
  '/admin/videos/:id',
  protect,
  requirePermission('videos.edit'),
  runUpload(uploadVideoMedia),
  ...videoUpdateValidation,
  validate,
  updateVideo
);
router.delete(
  '/admin/videos/:id',
  protect,
  requirePermission('videos.delete'),
  ...videoIdValidation,
  validate,
  deleteVideo
);

export default router;
