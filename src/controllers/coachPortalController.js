import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { withId } from '../utils/serialize.js';
import { dateKey } from '../utils/attendanceDate.js';
import { getCoachAttendanceHistory } from '../services/coachAttendanceCalc.js';

export const getMyCoachProfile = asyncHandler(async (req, res) => {
  const coach = await prisma.coach.findUnique({
    where: { id: req.user.coachId },
    include: { documents: true },
  });
  if (!coach) throw new ApiError(404, 'Coach not found');

  const loginAccount = await prisma.user.findUnique({
    where: { coachId: coach.id },
    select: { username: true, email: true, lastLoginAt: true, isActive: true },
  });

  res.json({
    success: true,
    data: {
      coach: withId({
        ...coach,
        username: loginAccount?.username || 0,
        loginEmail: loginAccount?.email || 0,
        lastLoginAt: loginAccount?.lastLoginAt || null,
      }),
    },
  });
});

export const getMyCoachAttendance = asyncHandler(async (req, res) => {
  const coachId = req.user.coachId;
  if (!coachId) throw new ApiError(403, 'Coach account is not linked.');

  // Never accept coachId from query/body — always use session identity
  const history = await getCoachAttendanceHistory(coachId, { period: 'all' });
  if (!history) throw new ApiError(404, 'Coach not found');

  const presentRows = await prisma.coachAttendance.findMany({
    where: { coachId },
    orderBy: [{ date: 'desc' }, { markedAt: 'desc' }],
    take: 200,
  });

  const seen = new Set();
  const records = [];
  for (const r of presentRows) {
    const key = dateKey(r.date);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      id: r.id,
      date: key,
      time: new Intl.DateTimeFormat('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      }).format(new Date(r.markedAt)),
      status: 'Present',
    });
  }

  // Merge absents from history matrix for display (most recent first)
  const matrixRows = (history.history || [])
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 60)
    .map((r) => ({
      id: `${r.date}-${r.status}`,
      date: r.date,
      dateDisplay: r.dateDisplay || r.date,
      time: r.status === 'Present' ? r.checkIn || 0 : 0,
      status: r.status,
      checkIn: r.checkIn || 0,
    }));

  const summary = history.summary || {};

  res.json({
    success: true,
    data: {
      summary: {
        present: summary.presentDays || 0,
        absent: summary.absentDays || 0,
        totalDays: summary.trainingDays || 0,
        trainingDays: summary.trainingDays || 0,
        presentDays: summary.presentDays || 0,
        absentDays: summary.absentDays || 0,
        attendanceRate: summary.attendancePercentage || 0,
        attendancePercentage: summary.attendancePercentage || 0,
      },
      records: matrixRows.length ? matrixRows : records,
      period: history.period,
    },
  });
});
