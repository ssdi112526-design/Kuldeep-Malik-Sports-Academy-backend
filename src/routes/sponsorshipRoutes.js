import { Router } from 'express';
import {
  protect,
  requireAdminAccess,
  requirePermission,
  requireAnyPermission,
} from '../middleware/auth.js';
import { uploadSponsorshipDoc, withMediaBlobBackup } from '../middleware/upload.js';
import * as ctrl from '../controllers/sponsorshipController.js';

const runSponsorshipUpload = withMediaBlobBackup(uploadSponsorshipDoc);

const router = Router();

const view = [
  protect,
  requireAdminAccess,
  requireAnyPermission('sponsorships.view', 'reports.view'),
];
const create = [protect, requireAdminAccess, requirePermission('sponsorships.create')];
const edit = [protect, requireAdminAccess, requirePermission('sponsorships.edit')];
const remove = [protect, requireAdminAccess, requirePermission('sponsorships.delete')];
const download = [
  protect,
  requireAdminAccess,
  requireAnyPermission('sponsorships.download', 'sponsorships.view'),
];
const exp = [
  protect,
  requireAdminAccess,
  requireAnyPermission('sponsorships.export', 'reports.export'),
];

router.get('/admin/sponsorships', ...view, ctrl.listSponsorships);
router.post('/admin/sponsorships/export', ...exp, ctrl.exportSponsorships);
router.get('/admin/sponsorships/:id/document', ...download, ctrl.downloadSponsorshipDocument);
router.get('/admin/sponsorships/:id', ...view, ctrl.getSponsorship);
router.post(
  '/admin/sponsorships',
  ...create,
  runSponsorshipUpload,
  ctrl.createSponsorship
);
router.put(
  '/admin/sponsorships/:id',
  ...edit,
  runSponsorshipUpload,
  ctrl.updateSponsorship
);
router.delete('/admin/sponsorships/:id', ...remove, ctrl.deleteSponsorship);

export default router;
