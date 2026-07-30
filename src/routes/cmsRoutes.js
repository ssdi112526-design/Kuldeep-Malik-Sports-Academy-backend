import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import {
  uploadSingle,
  uploadMultiple,
  uploadVideoMedia,
  handleMulterError,
} from '../middleware/upload.js';
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
const admin = [protect, authorize('admin')];

const runUpload = (uploader) => (req, res, next) => {
  uploader(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
  });
};

/* Public */
router.get('/programs', listProgramsPublic);
router.get('/gallery', listGalleryPublic);
router.get('/facilities', listFacilitiesPublic);
router.get('/videos', listVideosPublic);
router.get('/videos/:slug', ...videoSlugValidation, validate, getVideoBySlug);

/* Admin stats */
router.get('/admin/stats', ...admin, getContentStats);
router.get('/admin/videos/stats', ...admin, getVideoStats);

/* Admin Programs */
router.get('/admin/programs', ...admin, ...programListValidation, validate, listProgramsAdmin);
router.post(
  '/admin/programs',
  ...admin,
  runUpload(uploadSingle),
  ...programCreateValidation,
  validate,
  createProgram
);
router.put(
  '/admin/programs/:id',
  ...admin,
  runUpload(uploadSingle),
  ...programUpdateValidation,
  validate,
  updateProgram
);
router.delete('/admin/programs/:id', ...admin, ...programIdValidation, validate, deleteProgram);

/* Admin Gallery */
router.get('/admin/gallery', ...admin, ...galleryListValidation, validate, listGalleryAdmin);
router.post(
  '/admin/gallery',
  ...admin,
  runUpload(uploadMultiple),
  ...galleryCreateValidation,
  validate,
  createGalleryItem
);
router.put(
  '/admin/gallery/:id',
  ...admin,
  runUpload(uploadSingle),
  ...galleryUpdateValidation,
  validate,
  updateGalleryItem
);
router.delete('/admin/gallery/:id', ...admin, ...galleryIdValidation, validate, deleteGalleryItem);

/* Admin Facilities */
router.get('/admin/facilities', ...admin, ...facilityListValidation, validate, listFacilitiesAdmin);
router.post(
  '/admin/facilities',
  ...admin,
  runUpload(uploadSingle),
  ...facilityCreateValidation,
  validate,
  createFacility
);
router.put(
  '/admin/facilities/:id',
  ...admin,
  runUpload(uploadSingle),
  ...facilityUpdateValidation,
  validate,
  updateFacility
);
router.delete('/admin/facilities/:id', ...admin, ...facilityIdValidation, validate, deleteFacility);

/* Admin Videos */
router.get('/admin/videos', ...admin, ...videoListValidation, validate, listVideosAdmin);
router.post(
  '/admin/videos',
  ...admin,
  runUpload(uploadVideoMedia),
  ...videoCreateValidation,
  validate,
  createVideo
);
router.put(
  '/admin/videos/:id',
  ...admin,
  runUpload(uploadVideoMedia),
  ...videoUpdateValidation,
  validate,
  updateVideo
);
router.delete('/admin/videos/:id', ...admin, ...videoIdValidation, validate, deleteVideo);

export default router;
