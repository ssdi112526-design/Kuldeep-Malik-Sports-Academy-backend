import ExcelJS from 'exceljs';
import { cell0, mapRowsZeros } from './zeroEmpty.js';

export const EXPORT_COLUMNS = [
  { key: 'serial', label: 'S.No.' },
  { key: 'createdAtFormatted', label: 'Date & Time' },
  { key: 'fullName', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'message', label: 'Message' },
  { key: 'status', label: 'Status' },
];

export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function csvEscape(value) {
  const str = String(cell0(value) ?? 0);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvBuffer(rows, columns = EXPORT_COLUMNS) {
  const safeRows = mapRowsZeros(rows);
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const lines = safeRows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(','));
  const csv = [header, ...lines].join('\r\n');
  const BOM = '﻿';
  return Buffer.from(BOM + csv, 'utf8');
}

function normalizeRowForExcel(row, columns) {
  const out = {};
  for (const c of columns) {
    out[c.key] = cell0(row?.[c.key]);
  }
  for (const [k, v] of Object.entries(row || {})) {
    if (!(k in out)) out[k] = cell0(v);
  }
  return out;
}

function fillBlankCells(sheet, colCount) {
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= colCount; c += 1) {
      const cell = row.getCell(c);
      if (cell.value === null || cell.value === undefined || cell.value === '' || cell.value === '—') {
        cell.value = 0;
      }
    }
  }
}

export async function toXlsxBuffer(rows, columns = EXPORT_COLUMNS, options = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheetName = options.sheetName || 'Contacts';
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.width || Math.max(12, String(c.label).length + 2),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF7' },
  };

  (rows || []).forEach((row) => sheet.addRow(normalizeRowForExcel(row, columns)));

  if (options.freezeHeader !== false) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  if (options.autoFilter !== false && columns.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  fillBlankCells(sheet, columns.length);

  const statusKey = options.statusKey || 'status';
  if (options.colorStatus) {
    for (let i = 2; i <= sheet.rowCount; i += 1) {
      const cell = sheet.getRow(i).getCell(statusKey);
      const val = String(cell.value || '').toLowerCase();
      if (val === 'present') {
        cell.font = { color: { argb: 'FF067647' }, bold: true };
      } else if (val === 'absent') {
        cell.font = { color: { argb: 'FFB42318' }, bold: true };
      }
    }
  }

  return workbook.xlsx.writeBuffer();
}

/** Multi-sheet attendance workbook (Daily + Summary). */
export async function toAttendanceReportXlsx({ dailyRows, summaryRows, title = 'Attendance' } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Kuldeep Malik Sports Academy';
  workbook.created = new Date();

  const dailyCols = [
    { key: 'serial', label: 'S.No', width: 8 },
    { key: 'registrationId', label: 'Registration No', width: 16 },
    { key: 'studentName', label: 'Student Name', width: 22 },
    { key: 'fatherName', label: 'Father Name', width: 20 },
    { key: 'batch', label: 'Batch', width: 14 },
    { key: 'membershipType', label: 'Membership', width: 14 },
    { key: 'dateDisplay', label: 'Date', width: 12 },
    { key: 'status', label: 'Status', width: 10 },
    { key: 'checkIn', label: 'Check-in', width: 12 },
    { key: 'checkOut', label: 'Check-out', width: 12 },
    { key: 'sourceLabel', label: 'Source', width: 12 },
    { key: 'distanceLabel', label: 'Distance', width: 12 },
    { key: 'locationLabel', label: 'Location', width: 12 },
  ];

  const daily = workbook.addWorksheet('Daily Attendance');
  daily.columns = dailyCols.map((c) => ({ header: c.label, key: c.key, width: c.width }));
  styleHeader(daily);
  (dailyRows || []).forEach((row) => daily.addRow(normalizeRowForExcel(row, dailyCols)));
  daily.views = [{ state: 'frozen', ySplit: 1 }];
  daily.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: dailyCols.length },
  };
  fillBlankCells(daily, dailyCols.length);
  colorStatusColumn(daily, 'status');

  const summaryCols = [
    { key: 'serial', label: 'S.No', width: 8 },
    { key: 'registrationId', label: 'Registration No', width: 16 },
    { key: 'studentName', label: 'Student Name', width: 22 },
    { key: 'fatherName', label: 'Father Name', width: 20 },
    { key: 'trainingDays', label: 'Total Days', width: 12 },
    { key: 'present', label: 'Present', width: 10 },
    { key: 'absent', label: 'Absent', width: 10 },
    { key: 'attendanceRate', label: 'Attendance %', width: 14 },
  ];
  const summary = workbook.addWorksheet('Student Summary');
  summary.columns = summaryCols.map((c) => ({ header: c.label, key: c.key, width: c.width }));
  styleHeader(summary);
  (summaryRows || []).forEach((row) => summary.addRow(normalizeRowForExcel(row, summaryCols)));
  summary.views = [{ state: 'frozen', ySplit: 1 }];
  summary.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: summaryCols.length },
  };
  fillBlankCells(summary, summaryCols.length);

  const meta = workbook.addWorksheet('Report Info');
  meta.getColumn(1).width = 28;
  meta.getColumn(2).width = 40;
  meta.addRow(['Report', title || 0]);
  meta.addRow(['Generated At (IST)', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]);
  meta.getRow(1).font = { bold: true };

  return workbook.xlsx.writeBuffer();
}

function styleHeader(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF7' },
  };
}

function colorStatusColumn(sheet, key) {
  for (let i = 2; i <= sheet.rowCount; i += 1) {
    const cell = sheet.getRow(i).getCell(key);
    const val = String(cell.value || '').toLowerCase();
    if (val === 'present') cell.font = { color: { argb: 'FF067647' }, bold: true };
    if (val === 'absent') cell.font = { color: { argb: 'FFB42318' }, bold: true };
  }
}
