import { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { deleteUploadedFile, toPublicPath } from '../middleware/upload.js';
import { serializeMoney } from './financeService.js';

const STATUSES = new Set(['Active', 'Expired', 'Upcoming', 'Cancelled']);
/** Matches Decimal(18, 2) — max integer digits before overflow */
const MAX_AMOUNT = new Prisma.Decimal('9999999999999999.99');

function todayOnly() {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

/** Parse money safely for Prisma Decimal (no float math). */
export function parseSponsorshipAmount(value) {
  if (value === undefined || value === null || value === '') {
    return new Prisma.Decimal(0);
  }
  const raw = String(value).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new ApiError(400, 'Amount must be a valid number with up to 2 decimal places');
  }
  let amount;
  try {
    amount = new Prisma.Decimal(raw);
  } catch {
    throw new ApiError(400, 'Amount must be a valid number');
  }
  if (amount.isNeg()) throw new ApiError(400, 'Amount cannot be negative');
  if (amount.gt(MAX_AMOUNT)) {
    throw new ApiError(400, 'Amount is too large (maximum 9,999,999,999,999,999.99)');
  }
  return amount;
}

/** Derive display status from dates unless Cancelled */
export function deriveSponsorshipStatus(row, now = todayOnly()) {
  if (row.status === 'Cancelled') return 'Cancelled';
  const start = row.startDate ? new Date(row.startDate) : null;
  const end = row.endDate ? new Date(row.endDate) : null;
  if (start && start > now) return 'Upcoming';
  if (end && end < now) return 'Expired';
  return 'Active';
}

function serializeSponsorship(row) {
  const derived = deriveSponsorshipStatus(row);
  const end = row.endDate ? new Date(row.endDate) : null;
  const now = todayOnly();
  const daysToExpiry =
    end && end >= now ? Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null;
  return serializeMoney({
    ...row,
    id: row.id,
    _id: row.id,
    derivedStatus: derived,
    daysToExpiry,
    isExpiringSoon: daysToExpiry != null && daysToExpiry <= 30,
    documentUrl: row.documentPath || null,
  });
}

export async function listSponsorships({
  search,
  status,
  from,
  to,
  page = 1,
  limit = 20,
  expiry = '',
} = {}) {
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const where = { deletedAt: null };

  if (search?.trim()) {
    const q = search.trim();
    where.OR = [
      { sponsorName: { contains: q, mode: 'insensitive' } },
      { sponsorshipType: { contains: q, mode: 'insensitive' } },
      { notes: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (from || to) {
    where.startDate = {};
    if (from) where.startDate.gte = new Date(from);
    if (to) where.startDate.lte = new Date(to);
  }

  const [total, rows] = await Promise.all([
    prisma.sponsorship.count({ where }),
    prisma.sponsorship.findMany({
      where,
      orderBy: [{ endDate: 'asc' }, { sponsorName: 'asc' }],
      skip,
      take,
    }),
  ]);

  let mapped = rows.map(serializeSponsorship);
  if (status) {
    const s = String(status);
    mapped = mapped.filter((r) => r.derivedStatus === s || r.status === s);
  }
  if (expiry === 'expired') {
    mapped = mapped.filter((r) => r.derivedStatus === 'Expired');
  } else if (expiry === 'upcoming') {
    mapped = mapped.filter((r) => r.isExpiringSoon || r.derivedStatus === 'Upcoming');
  }

  return {
    total: status || expiry ? mapped.length : total,
    page: Number(page) || 1,
    limit: take,
    rows: mapped,
  };
}

export async function getSponsorship(id) {
  const row = await prisma.sponsorship.findFirst({ where: { id, deletedAt: null } });
  if (!row) throw new ApiError(404, 'Sponsorship not found');
  return serializeSponsorship(row);
}

export async function createSponsorship(payload, userId, file) {
  const sponsorName = String(payload.sponsorName || '').trim();
  const sponsorshipType = String(payload.sponsorshipType || '').trim();
  if (!sponsorName) throw new ApiError(400, 'Sponsor name is required');
  if (!sponsorshipType) throw new ApiError(400, 'Sponsorship type is required');
  if (!payload.startDate) throw new ApiError(400, 'Start date is required');

  let status = String(payload.status || 'Active');
  if (!STATUSES.has(status)) status = 'Active';

  const documentPath = file
    ? toPublicPath(file.filename, 'entry/sponsorships')
    : payload.documentPath || null;
  const documentName = file ? file.originalname : payload.documentName || null;

  const created = await prisma.sponsorship.create({
    data: {
      sponsorName,
      sponsorshipType,
      amount: parseSponsorshipAmount(payload.amount),
      startDate: new Date(payload.startDate),
      endDate: payload.endDate ? new Date(payload.endDate) : null,
      status,
      documentPath,
      documentName,
      notes: payload.notes ? String(payload.notes).trim() : null,
      createdById: userId || null,
      updatedById: userId || null,
    },
  });
  return serializeSponsorship(created);
}

export async function updateSponsorship(id, payload, userId, file) {
  const existing = await prisma.sponsorship.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(404, 'Sponsorship not found');

  const data = { updatedById: userId || null };
  if (payload.sponsorName !== undefined) data.sponsorName = String(payload.sponsorName).trim();
  if (payload.sponsorshipType !== undefined) {
    data.sponsorshipType = String(payload.sponsorshipType).trim();
  }
  if (payload.amount !== undefined) data.amount = parseSponsorshipAmount(payload.amount);
  if (payload.startDate !== undefined) data.startDate = new Date(payload.startDate);
  if (payload.endDate !== undefined) {
    data.endDate = payload.endDate ? new Date(payload.endDate) : null;
  }
  if (payload.status !== undefined && STATUSES.has(String(payload.status))) {
    data.status = String(payload.status);
  }
  if (payload.notes !== undefined) data.notes = payload.notes ? String(payload.notes).trim() : null;

  if (file) {
    if (existing.documentPath) deleteUploadedFile(existing.documentPath);
    data.documentPath = toPublicPath(file.filename, 'entry/sponsorships');
    data.documentName = file.originalname;
  }

  const updated = await prisma.sponsorship.update({ where: { id }, data });
  return serializeSponsorship(updated);
}

export async function softDeleteSponsorship(id, userId) {
  const existing = await prisma.sponsorship.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(404, 'Sponsorship not found');
  await prisma.sponsorship.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: userId || null },
  });
  return { ok: true };
}

export async function countActiveSponsorships() {
  const rows = await prisma.sponsorship.findMany({
    where: { deletedAt: null, status: { not: 'Cancelled' } },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  return rows.filter((r) => deriveSponsorshipStatus(r) === 'Active').length;
}
