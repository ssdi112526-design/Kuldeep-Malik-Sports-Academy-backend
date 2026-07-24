import prisma from '../config/db.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withIds } from '../utils/serialize.js';

export const getSiteContent = asyncHandler(async (req, res) => {
  const [services, products, partners, team, coverage, faqs, equipment] =
    await Promise.all([
      prisma.service.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
      prisma.product.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
      prisma.partner.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
      prisma.teamMember.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
      prisma.coverageArea.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
      prisma.fAQ.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
      prisma.equipment.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
    ]);

  res.status(200).json({
    success: true,
    data: {
      services: withIds(services),
      products: withIds(products),
      partners: withIds(partners),
      team: withIds(team),
      coverage: withIds(coverage),
      faqs: withIds(faqs),
      equipment: withIds(equipment),
    },
  });
});
