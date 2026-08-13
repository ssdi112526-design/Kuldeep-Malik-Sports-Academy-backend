import { Router } from 'express';
import { protect, requirePermission, requireAnyPermission, requireAdminAccess } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import {
  uploadSingle,
  uploadMultiple,
  uploadVideoMedia,
  uploadSiteSettings,
  withMediaBlobBackup,
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
  listAthletesPublic,
  listAthletesAdmin,
  createAthlete,
  updateAthlete,
  deleteAthlete,
  athleteListValidation,
  athleteCreateValidation,
  athleteUpdateValidation,
  athleteIdValidation,
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

const runUpload = (uploader) => withMediaBlobBackup(uploader);

const programsRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('programs'))];
const galleryRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('gallery'))];
const athletesRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('athletes'))];
const facilitiesRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('facilities'))];
const featuresRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('features'))];
const membershipRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('membership'))];
const websiteRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('website_content'))];
const videosRead = [protect, requireAdminAccess, requireAnyPermission(...modulePermissionKeys('videos'))];
const dashboardRead = [
  protect,
  requireAdminAccess,
  requireAnyPermission(
    ...modulePermissionKeys('dashboard'),
    ...modulePermissionKeys('programs'),
    ...modulePermissionKeys('gallery'),
    ...modulePermissionKeys('athletes'),
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
router.get('/athletes', listAthletesPublic);
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
  requireAdminAccess,
  requirePermission('programs.create'),
  runUpload(uploadSingle),
  ...programCreateValidation,
  validate,
  createProgram
);
router.put(
  '/admin/programs/:id',
  protect,
  requireAdminAccess,
  requirePermission('programs.edit'),
  runUpload(uploadSingle),
  ...programUpdateValidation,
  validate,
  updateProgram
);
router.delete(
  '/admin/programs/:id',
  protect,
  requireAdminAccess,
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
  requireAdminAccess,
  requirePermission('gallery.create'),
  runUpload(uploadMultiple),
  ...galleryCreateValidation,
  validate,
  createGalleryItem
);
router.put(
  '/admin/gallery/:id',
  protect,
  requireAdminAccess,
  requirePermission('gallery.edit'),
  runUpload(uploadSingle),
  ...galleryUpdateValidation,
  validate,
  updateGalleryItem
);
router.delete(
  '/admin/gallery/:id',
  protect,
  requireAdminAccess,
  requirePermission('gallery.delete'),
  ...galleryIdValidation,
  validate,
  deleteGalleryItem
);

/* Admin Athletes (Meet Our Wrestlers) */
router.get('/admin/athletes', ...athletesRead, ...athleteListValidation, validate, listAthletesAdmin);
router.post(
  '/admin/athletes',
  protect,
  requireAdminAccess,
  requirePermission('athletes.create'),
  runUpload(uploadSingle),
  ...athleteCreateValidation,
  validate,
  createAthlete
);
router.put(
  '/admin/athletes/:id',
  protect,
  requireAdminAccess,
  requirePermission('athletes.edit'),
  runUpload(uploadSingle),
  ...athleteUpdateValidation,
  validate,
  updateAthlete
);
router.delete(
  '/admin/athletes/:id',
  protect,
  requireAdminAccess,
  requirePermission('athletes.delete'),
  ...athleteIdValidation,
  validate,
  deleteAthlete
);

/* Admin Facilities */
router.get('/admin/facilities', ...facilitiesRead, ...facilityListValidation, validate, listFacilitiesAdmin);
router.post(
  '/admin/facilities',
  protect,
  requireAdminAccess,
  requirePermission('facilities.create'),
  runUpload(uploadSingle),
  ...facilityCreateValidation,
  validate,
  createFacility
);
router.put(
  '/admin/facilities/:id',
  protect,
  requireAdminAccess,
  requirePermission('facilities.edit'),
  runUpload(uploadSingle),
  ...facilityUpdateValidation,
  validate,
  updateFacility
);
router.delete(
  '/admin/facilities/:id',
  protect,
  requireAdminAccess,
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
  requireAdminAccess,
  requirePermission('features.create'),
  runUpload(uploadSingle),
  ...featureCreateValidation,
  validate,
  createFeature
);
router.put(
  '/admin/features/:id',
  protect,
  requireAdminAccess,
  requirePermission('features.edit'),
  runUpload(uploadSingle),
  ...featureUpdateValidation,
  validate,
  updateFeature
);
router.delete(
  '/admin/features/:id',
  protect,
  requireAdminAccess,
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
  requireAdminAccess,
  requirePermission('membership.create'),
  runUpload(uploadSingle),
  ...membershipCreateValidation,
  validate,
  createMembershipPlan
);
router.put(
  '/admin/membership-plans/:id',
  protect,
  requireAdminAccess,
  requirePermission('membership.edit'),
  runUpload(uploadSingle),
  ...membershipUpdateValidation,
  validate,
  updateMembershipPlan
);
router.delete(
  '/admin/membership-plans/:id',
  protect,
  requireAdminAccess,
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
  requireAdminAccess,
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
  requireAdminAccess,
  requirePermission('videos.create'),
  runUpload(uploadVideoMedia),
  ...videoCreateValidation,
  validate,
  createVideo
);
router.put(
  '/admin/videos/:id',
  protect,
  requireAdminAccess,
  requirePermission('videos.edit'),
  runUpload(uploadVideoMedia),
  ...videoUpdateValidation,
  validate,
  updateVideo
);
router.delete(
  '/admin/videos/:id',
  protect,
  requireAdminAccess,
  requirePermission('videos.delete'),
  ...videoIdValidation,
  validate,
  deleteVideo
);

export default router;
