import { Router } from 'express';
import { protect, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import {
  uploadSingle,
  uploadMultiple,
  uploadVideoMedia,
  uploadSiteSettings,
  handleMulterError,
} from '../middleware/upload.js';
import { rememberMulterUploads } from '../utils/mediaBlobStore.js';
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
  listFeaturesPublic,
  listFeaturesAdmin,
  createFeature,
  updateFeature,
  deleteFeature,
  featureListValidation,
  featureCreateValidation,
  featureUpdateValidation,
  featureIdValidation,
  listMembershipPlansPublic,
  listMembershipPlansAdmin,
  createMembershipPlan,
  updateMembershipPlan,
  deleteMembershipPlan,
  membershipListValidation,
  membershipCreateValidation,
  membershipUpdateValidation,
  membershipIdValidation,
  getSiteSettingsPublic,
  getSiteSettingsAdmin,
  updateSiteSetting,
  siteSettingUpdateValidation,
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
  uploader(req, res, async (err) => {
    if (err) return handleMulterError(err, req, res, next);
    try {
      await rememberMulterUploads(req);
    } catch (persistErr) {
      console.warn('[media-blob] persist after CMS upload failed:', persistErr.message);
    }
    next();
  });
};

const programsRead = [protect, requireAnyPermission(...modulePermissionKeys('programs'))];
const galleryRead = [protect, requireAnyPermission(...modulePermissionKeys('gallery'))];
const facilitiesRead = [protect, requireAnyPermission(...modulePermissionKeys('facilities'))];
const featuresRead = [protect, requireAnyPermission(...modulePermissionKeys('features'))];
const membershipRead = [protect, requireAnyPermission(...modulePermissionKeys('membership'))];
const websiteRead = [protect, requireAnyPermission(...modulePermissionKeys('website_content'))];
const videosRead = [protect, requireAnyPermission(...modulePermissionKeys('videos'))];
const dashboardRead = [
  protect,
  requireAnyPermission(
    ...modulePermissionKeys('dashboard'),
    ...modulePermissionKeys('programs'),
    ...modulePermissionKeys('gallery'),
    ...modulePermissionKeys('facilities'),
    ...modulePermissionKeys('features'),
    ...modulePermissionKeys('membership'),
    ...modulePermissionKeys('website_content'),
    ...modulePermissionKeys('videos')
  ),
];

/* Public */
router.get('/programs', listProgramsPublic);
router.get('/gallery', listGalleryPublic);
router.get('/facilities', listFacilitiesPublic);
router.get('/features', listFeaturesPublic);
router.get('/membership-plans', listMembershipPlansPublic);
router.get('/site-settings', getSiteSettingsPublic);
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

/* Admin Features */
router.get('/admin/features', ...featuresRead, ...featureListValidation, validate, listFeaturesAdmin);
router.post(
  '/admin/features',
  protect,
  requirePermission('features.create'),
  runUpload(uploadSingle),
  ...featureCreateValidation,
  validate,
  createFeature
);
router.put(
  '/admin/features/:id',
  protect,
  requirePermission('features.edit'),
  runUpload(uploadSingle),
  ...featureUpdateValidation,
  validate,
  updateFeature
);
router.delete(
  '/admin/features/:id',
  protect,
  requirePermission('features.delete'),
  ...featureIdValidation,
  validate,
  deleteFeature
);

/* Admin Membership plans */
router.get(
  '/admin/membership-plans',
  ...membershipRead,
  ...membershipListValidation,
  validate,
  listMembershipPlansAdmin
);
router.post(
  '/admin/membership-plans',
  protect,
  requirePermission('membership.create'),
  runUpload(uploadSingle),
  ...membershipCreateValidation,
  validate,
  createMembershipPlan
);
router.put(
  '/admin/membership-plans/:id',
  protect,
  requirePermission('membership.edit'),
  runUpload(uploadSingle),
  ...membershipUpdateValidation,
  validate,
  updateMembershipPlan
);
router.delete(
  '/admin/membership-plans/:id',
  protect,
  requirePermission('membership.delete'),
  ...membershipIdValidation,
  validate,
  deleteMembershipPlan
);

/* Admin Website content / site settings */
router.get('/admin/site-settings', ...websiteRead, getSiteSettingsAdmin);
router.put(
  '/admin/site-settings',
  protect,
  requirePermission('website_content.edit'),
  runUpload(uploadSiteSettings),
  ...siteSettingUpdateValidation,
  validate,
  updateSiteSetting
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
