import { query } from 'express-validator';
import prisma from '../config/db.js';
import asyncHandler from '../utils/asyncHandler.js';

const PER_GROUP = 8;
const MAX_TOTAL = 40;

export const globalSearchValidation = [
  query('q').trim().isLength({ min: 2, max: 80 }).withMessage('Query must be 2–80 characters'),
  query('limit').optional().isInt({ min: 1, max: 20 }),
];

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function looksLikePhone(q) {
  const d = digitsOnly(q);
  return d.length >= 3 && d.length <= 15 && /^\d+$/.test(d);
}

function looksLikeUuid(q) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q);
}

function canModule(req, menu) {
  if (req.user?.isSuperAdmin || req.permissions?.includes('*.*')) return true;
  const perms = req.permissions || [];
  return perms.some((p) => p === menu || p.startsWith(`${menu}.`));
}

function resultItem({
  type,
  id,
  title,
  subtitle,
  code,
  mobile,
  status,
  photo,
  section,
  meta = {},
}) {
  return {
    type,
    id,
    title,
    subtitle: subtitle || null,
    code: code || null,
    mobile: mobile || null,
    status: status || null,
    photo: photo || null,
    section,
    meta,
  };
}

export const globalSearch = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const perGroup = Math.min(PER_GROUP, Math.max(1, parseInt(req.query.limit, 10) || PER_GROUP));
  const qLower = q.toLowerCase();
  const phoneDigits = digitsOnly(q);
  const isPhone = looksLikePhone(q);
  const isUuid = looksLikeUuid(q);

  const groups = [];
  let total = 0;

  const pushGroup = (key, label, items) => {
    if (!items.length || total >= MAX_TOTAL) return;
    const sliced = items.slice(0, Math.min(perGroup, MAX_TOTAL - total));
    total += sliced.length;
    groups.push({ key, label, items: sliced, count: sliced.length });
  };

  // ── Players ──
  if (canModule(req, 'students') && total < MAX_TOTAL) {
    const or = [
      { registrationNumber: { contains: q, mode: 'insensitive' } },
      { fullName: { contains: q, mode: 'insensitive' } },
      ...(isUuid ? [{ id: q }] : []),
      ...(isPhone
        ? [
            { mobileNumber: { contains: phoneDigits } },
            { alternateMobile: { contains: phoneDigits } },
            { guardianMobile: { contains: phoneDigits } },
          ]
        : [
            { mobileNumber: { contains: q, mode: 'insensitive' } },
            { alternateMobile: { contains: q, mode: 'insensitive' } },
          ]),
    ];

    const students = await prisma.student.findMany({
      where: { OR: or },
      select: {
        id: true,
        fullName: true,
        registrationNumber: true,
        mobileNumber: true,
        category: true,
        status: true,
        photo: true,
        membershipType: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: perGroup,
    });

    pushGroup(
      'players',
      'Players',
      students.map((s) =>
        resultItem({
          type: 'player',
          id: s.id,
          title: s.fullName,
          subtitle: s.category || s.membershipType || null,
          code: s.registrationNumber,
          mobile: s.mobileNumber,
          status: s.status,
          photo: s.photo,
          section: 'students',
          meta: { category: s.category || s.membershipType || null },
        })
      )
    );
  }

  // ── Employees / Coaches ──
  if (canModule(req, 'coaches') && total < MAX_TOTAL) {
    const or = [
      { coachCode: { contains: q, mode: 'insensitive' } },
      { fullName: { contains: q, mode: 'insensitive' } },
      ...(isUuid ? [{ id: q }] : []),
      ...(isPhone
        ? [{ mobile: { contains: phoneDigits } }]
        : [{ mobile: { contains: q, mode: 'insensitive' } }]),
    ];

    const coaches = await prisma.coach.findMany({
      where: { OR: or },
      select: {
        id: true,
        fullName: true,
        coachCode: true,
        mobile: true,
        status: true,
        photo: true,
        designation: true,
        category: true,
        employeeRole: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: perGroup,
    });

    pushGroup(
      'employees',
      'Employees',
      coaches.map((c) =>
        resultItem({
          type: 'employee',
          id: c.id,
          title: c.fullName,
          subtitle: c.category || c.employeeRole || c.designation || 'Employee',
          code: c.coachCode,
          mobile: c.mobile,
          status: c.status,
          photo: c.photo,
          section: 'coaches',
          meta: { category: c.category || c.employeeRole || c.designation || 'Coach' },
        })
      )
    );
  }

  // ── Parents ──
  if (canModule(req, 'students') && total < MAX_TOTAL) {
    const or = [
      { fullName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      ...(isUuid ? [{ id: q }, { userId: q }] : []),
      ...(isPhone
        ? [{ phone: { contains: phoneDigits } }, { user: { mobile: { contains: phoneDigits } } }]
        : [
            { phone: { contains: q, mode: 'insensitive' } },
            { user: { mobile: { contains: q, mode: 'insensitive' } } },
          ]),
    ];

    const parents = await prisma.parentProfile.findMany({
      where: { OR: or },
      select: {
        id: true,
        fullName: true,
        phone: true,
        email: true,
        relation: true,
        photo: true,
        user: { select: { id: true, mobile: true, email: true } },
        links: {
          take: 2,
          select: { student: { select: { fullName: true, registrationNumber: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: perGroup,
    });

    pushGroup(
      'parents',
      'Parents',
      parents.map((p) => {
        const linked = p.links
          .map((l) => l.student?.fullName)
          .filter(Boolean)
          .join(', ');
        return resultItem({
          type: 'parent',
          id: p.id,
          title: p.fullName,
          subtitle: linked ? `Linked: ${linked}` : p.relation || 'Parent',
          code: p.user?.id ? `PAR-${p.id.slice(0, 8).toUpperCase()}` : null,
          mobile: p.phone || p.user?.mobile || null,
          status: p.relation || 'Parent',
          photo: p.photo,
          section: 'parents',
          meta: { email: p.email || p.user?.email || null },
        });
      })
    );
  }

  // ── Achievements (by player name / title — ID-ish queries skip) ──
  if (
    (canModule(req, 'player_achievements') || canModule(req, 'achievements')) &&
    total < MAX_TOTAL &&
    !isPhone &&
    q.length >= 2
  ) {
    const achievements = await prisma.playerAchievement.findMany({
      where: {
        OR: [
          { playerName: { contains: q, mode: 'insensitive' } },
          { title: { contains: q, mode: 'insensitive' } },
          ...(isUuid ? [{ id: q }] : []),
        ],
      },
      select: {
        id: true,
        playerName: true,
        title: true,
        medal: true,
        year: true,
        image: true,
        showOnWebsite: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: perGroup,
    });

    pushGroup(
      'achievements',
      'Achievements',
      achievements.map((a) =>
        resultItem({
          type: 'achievement',
          id: a.id,
          title: a.playerName || a.title,
          subtitle: a.title,
          code: a.medal || null,
          mobile: null,
          status: a.showOnWebsite ? 'Visible' : 'Hidden',
          photo: a.image,
          section: 'achievements',
          meta: { year: a.year, medal: a.medal },
        })
      )
    );
  }

  // ── Tournaments ──
  if (canModule(req, 'tournaments') && total < MAX_TOTAL && !isPhone) {
    const tournaments = await prisma.tournament.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
          ...(isUuid ? [{ id: q }] : []),
        ],
      },
      select: {
        id: true,
        name: true,
        location: true,
        eventDate: true,
        category: true,
        image: true,
      },
      orderBy: { eventDate: 'desc' },
      take: perGroup,
    });

    pushGroup(
      'tournaments',
      'Tournaments',
      tournaments.map((t) =>
        resultItem({
          type: 'tournament',
          id: t.id,
          title: t.name,
          subtitle: t.location || t.category || null,
          code: t.eventDate ? String(new Date(t.eventDate).getUTCFullYear()) : null,
          mobile: null,
          status: t.category || null,
          photo: t.image,
          section: 'tournaments',
          meta: { eventDate: t.eventDate },
        })
      )
    );
  }

  // Soft name match boost already handled by contains; empty groups omitted
  void qLower;

  res.json({
    success: true,
    data: {
      q,
      total,
      groups,
    },
  });
});
