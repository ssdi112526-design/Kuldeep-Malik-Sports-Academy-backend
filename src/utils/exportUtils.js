import ExcelJS from 'exceljs';

export const EXPORT_COLUMNS = [
  { key: 'serial', label: 'S.No.' },
  { key: 'createdAtFormatted', label: 'Date & Time' },
  { key: 'fullName', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'panNumber', label: 'PAN' },
  { key: 'aadhaarNumber', label: 'Aadhaar' },
  { key: 'message', label: 'Message' },
  { key: 'status', label: 'Status' },
];

export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsvBuffer(rows, columns = EXPORT_COLUMNS) {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(','));
  const csv = [header, ...lines].join('\r\n');
  const BOM = '﻿';
  return Buffer.from(BOM + csv, 'utf8');
}

export async function toXlsxBuffer(rows, columns = EXPORT_COLUMNS) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contacts');

  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: 22 }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  rows.forEach((row) => sheet.addRow(row));

  return workbook.xlsx.writeBuffer();
}
