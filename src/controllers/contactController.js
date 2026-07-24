import { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendNewContactNotification } from '../services/emailService.js';
import { toCsvBuffer, toXlsxBuffer, EXPORT_COLUMNS } from '../utils/exportUtils.js';
import { buildDateRangeFilter, startOfIstToday } from '../utils/dateRange.js';
import { withId, withIds } from '../utils/serialize.js';

const SEARCH_FIELDS = ['fullName', 'email', 'phone', 'organisation', 'message'];

function buildContactFilter({ status, search, dateFilter, startDate, endDate }) {
  const where = {};

  if (status) where.status = status;

  const dateRange = buildDateRangeFilter(dateFilter, startDate, endDate);
  if (dateRange) where.createdAt = dateRange;

  if (search?.trim()) {
    const term = search.trim();
    where.OR = SEARCH_FIELDS.map((field) => ({
      [field]: { contains: term, mode: 'insensitive' },
    }));
  }

  return where;
}

export const createContact = asyncHandler(async (req, res) => {
  const contact = await prisma.contact.create({ data: req.body });
  const serialized = withId(contact);

  sendNewContactNotification(contact, req);

  res.status(201).json({
    success: true,
    message: "Message Sent! We'll get back to you shortly.",
    data: { contact: serialized },
  });
});

export const getContacts = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const where = buildContactFilter(req.query);
  const skip = (page - 1) * limit;

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.contact.count({ where }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      contacts: withIds(contacts),
      pagination: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    },
  });
});

export const getContactStats = asyncHandler(async (req, res) => {
  const [totalContacts, todayContacts, statusAgg] = await Promise.all([
    prisma.contact.count(),
    prisma.contact.count({ where: { createdAt: { gte: startOfIstToday() } } }),
    prisma.contact.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
  ]);

  const statusBreakdown = { new: 0, in_progress: 0, resolved: 0, closed: 0 };
  statusAgg.forEach(({ status, _count }) => {
    if (status in statusBreakdown) statusBreakdown[status] = _count.status;
  });

  res.status(200).json({
    success: true,
    data: {
      totalContacts,
      totalMessages: totalContacts,
      todayContacts,
      statusBreakdown,
    },
  });
});

export const getContactById = asyncHandler(async (req, res) => {
  const contact = await prisma.contact.findUnique({ where: { id: req.params.id } });
  if (!contact) {
    throw new ApiError(404, 'Contact message not found');
  }

  res.status(200).json({
    success: true,
    data: { contact: withId(contact) },
  });
});

export const bulkDeleteContacts = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  const result = await prisma.contact.deleteMany({ where: { id: { in: ids } } });

  res.status(200).json({
    success: true,
    message: `${result.count} record(s) deleted`,
    data: { deletedCount: result.count },
  });
});

export const exportContacts = asyncHandler(async (req, res) => {
  const { ids, format } = req.body;

  const contacts = await prisma.contact.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: 'desc' },
  });

  const rows = contacts.map((contact, index) => ({
    serial: index + 1,
    createdAtFormatted: new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(contact.createdAt)),
    fullName: contact.fullName,
    email: contact.email,
    phone: contact.phone || '',
    organisation: contact.organisation || '',
    serviceRequired: contact.serviceRequired,
    message: contact.message,
    status: contact.status,
  }));

  const timestamp = new Date().toISOString().slice(0, 10);

  if (format === 'xlsx') {
    const buffer = await toXlsxBuffer(rows, EXPORT_COLUMNS);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="contacts-${timestamp}.xlsx"`);
    return res.send(buffer);
  }

  const buffer = toCsvBuffer(rows, EXPORT_COLUMNS);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="contacts-${timestamp}.csv"`);
  res.send(buffer);
});

export const updateContactStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ['new', 'in_progress', 'resolved', 'closed'];

  if (!allowed.includes(status)) {
    throw new ApiError(400, 'Invalid status value');
  }

  try {
    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.status(200).json({
      success: true,
      message: 'Status updated',
      data: { contact: withId(contact) },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new ApiError(404, 'Contact message not found');
    }
    throw error;
  }
});

export const deleteContact = asyncHandler(async (req, res) => {
  try {
    await prisma.contact.delete({ where: { id: req.params.id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new ApiError(404, 'Contact message not found');
    }
    throw error;
  }

  res.status(200).json({
    success: true,
    message: 'Contact deleted',
  });
});
