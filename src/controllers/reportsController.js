import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { toCsvBuffer, toXlsxBuffer } from '../utils/exportUtils.js';
import * as reports from '../services/reportsService.js';

export const reportsDashboard = asyncHandler(async (_req, res) => {
  const data = await reports.getReportsDashboard();
  res.json({ success: true, data });
});

export const playersReport = asyncHandler(async (req, res) => {
  const data = await reports.reportPlayers(req.query);
  res.json({ success: true, data });
});

export const kheloIndiaReport = asyncHandler(async (req, res) => {
  const data = await reports.reportKheloIndia(req.query);
  res.json({ success: true, data });
});

export const attendanceDashboardReport = asyncHandler(async (req, res) => {
  const data = await reports.reportAttendanceDashboard(req.query);
  res.json({ success: true, data });
});

export const monthlyAttendanceReport = asyncHandler(async (req, res) => {
  const data = await reports.reportMonthlyAttendance(req.query);
  res.json({ success: true, data });
});

export const employeeAttendanceReport = asyncHandler(async (req, res) => {
  const data = await reports.reportEmployeeAttendance(req.query);
  res.json({ success: true, data });
});

export const ageCategoryReport = asyncHandler(async (req, res) => {
  const data = await reports.reportAgeCategories(req.query);
  res.json({ success: true, data });
});

export const playerCategoryReport = asyncHandler(async (req, res) => {
  const data = await reports.reportPlayerCategories(req.query);
  res.json({ success: true, data });
});

export const weightCategoryReport = asyncHandler(async (req, res) => {
  const data = await reports.reportWeightCategories(req.query);
  res.json({ success: true, data });
});

export const tournamentsReport = asyncHandler(async (req, res) => {
  const data = await reports.reportTournaments(req.query);
  res.json({ success: true, data });
});

export const medalsReport = asyncHandler(async (req, res) => {
  const data = await reports.reportMedals(req.query);
  res.json({ success: true, data });
});

export const pendingFeesReport = asyncHandler(async (req, res) => {
  const data = await reports.reportPendingFees(req.query);
  res.json({ success: true, data });
});

export const salaryReport = asyncHandler(async (req, res) => {
  const data = await reports.reportEmployeeSalary(req.query);
  res.json({ success: true, data });
});

export const sponsorshipDocumentsReport = asyncHandler(async (req, res) => {
  const data = await reports.reportSponsorshipDocuments(req.query);
  res.json({ success: true, data });
});

export const exportReport = asyncHandler(async (req, res) => {
  const reportKey = req.params.reportKey;
  const format = String(req.body?.format || req.query.format || 'xlsx').toLowerCase();
  const filters = { ...req.query, ...req.body };
  delete filters.format;

  let payload;
  try {
    payload = await reports.buildExportPayload(reportKey, filters);
  } catch (err) {
    throw new ApiError(err.statusCode || 400, err.message || 'Export failed');
  }

  const { columns, rows, sheetName } = payload;
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `report-${reportKey}-${stamp}.${format === 'csv' ? 'csv' : 'xlsx'}`;

  if (format === 'csv') {
    const buf = toCsvBuffer(rows, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  }

  const buf = await toXlsxBuffer(rows, columns, { sheetName: sheetName || 'Report' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buf);
});
