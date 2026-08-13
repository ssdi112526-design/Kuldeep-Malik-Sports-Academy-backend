import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { writeAuditLog } from '../utils/rbac.js';
import { toCsvBuffer, toXlsxBuffer } from '../utils/exportUtils.js';
import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from '../middleware/upload.js';
import * as sponsorship from '../services/sponsorshipService.js';

export const listSponsorships = asyncHandler(async (req, res) => {
  const data = await sponsorship.listSponsorships(req.query);
  res.json({ success: true, data });
});

export const getSponsorship = asyncHandler(async (req, res) => {
  const row = await sponsorship.getSponsorship(req.params.id);
  res.json({ success: true, data: { sponsorship: row } });
});

export const createSponsorship = asyncHandler(async (req, res) => {
  const row = await sponsorship.createSponsorship(req.body, req.user?.id, req.file);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'sponsorship.create',
    entity: 'Sponsorship',
    entityId: row.id,
    details: { sponsorName: row.sponsorName },
    req,
  });
  res.status(201).json({ success: true, data: { sponsorship: row }, message: 'Sponsorship created' });
});

export const updateSponsorship = asyncHandler(async (req, res) => {
  const row = await sponsorship.updateSponsorship(req.params.id, req.body, req.user?.id, req.file);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'sponsorship.update',
    entity: 'Sponsorship',
    entityId: row.id,
    details: req.body,
    req,
  });
  res.json({ success: true, data: { sponsorship: row }, message: 'Sponsorship updated' });
});

export const deleteSponsorship = asyncHandler(async (req, res) => {
  await sponsorship.softDeleteSponsorship(req.params.id, req.user?.id);
  await writeAuditLog({
    userId: req.user?.id,
    action: 'sponsorship.delete',
    entity: 'Sponsorship',
    entityId: req.params.id,
    req,
  });
  res.json({ success: true, message: 'Sponsorship deleted' });
});

export const downloadSponsorshipDocument = asyncHandler(async (req, res) => {
  const row = await sponsorship.getSponsorship(req.params.id);
  if (!row.documentPath) throw new ApiError(404, 'No document attached');
  const relative = String(row.documentPath).replace(/^\/uploads\//, '');
  const full = path.join(UPLOADS_DIR, relative);
  if (!fs.existsSync(full)) {
    const { restoreFileFromDb } = await import('../utils/mediaBlobStore.js');
    const restored = await restoreFileFromDb(row.documentPath);
    if (!restored || !fs.existsSync(full)) throw new ApiError(404, 'Document file not found');
  }
  const name = row.documentName || path.basename(full);
  res.download(full, name);
});

export const exportSponsorships = asyncHandler(async (req, res) => {
  const format = String(req.body?.format || req.query.format || 'xlsx').toLowerCase();
  const { rows } = await sponsorship.listSponsorships({
    ...req.body,
    ...req.query,
    page: 1,
    limit: 5000,
  });
  const columns = [
    { key: 'sponsorName', label: 'Sponsor' },
    { key: 'sponsorshipType', label: 'Type' },
    { key: 'amount', label: 'Amount' },
    { key: 'startDate', label: 'Start' },
    { key: 'endDate', label: 'End' },
    { key: 'derivedStatus', label: 'Status' },
    { key: 'documentName', label: 'Document' },
    { key: 'notes', label: 'Notes' },
  ];
  const mapped = rows.map((r) => ({
    sponsorName: r.sponsorName,
    sponsorshipType: r.sponsorshipType,
    amount: r.amount,
    startDate: r.startDate ? new Date(r.startDate).toLocaleDateString('en-IN') : '',
    endDate: r.endDate ? new Date(r.endDate).toLocaleDateString('en-IN') : '',
    derivedStatus: r.derivedStatus,
    documentName: r.documentName || '',
    notes: r.notes || '',
  }));
  if (format === 'csv') {
    const buf = toCsvBuffer(mapped, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sponsorships.csv"');
    return res.send(buf);
  }
  const buf = await toXlsxBuffer(mapped, columns, { sheetName: 'Sponsorships' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sponsorships.xlsx"');
  return res.send(buf);
});
