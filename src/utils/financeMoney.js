import ApiError from '../utils/ApiError.js';

export function money(value) {
  if (value == null || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function moneyStr(value) {
  return money(value).toFixed(2);
}

export function addMoney(...vals) {
  return money(vals.reduce((s, v) => s + money(v), 0));
}

export function subMoney(a, b) {
  return money(money(a) - money(b));
}

export function clampNonNegative(value) {
  return Math.max(0, money(value));
}

export function feeStatusFromAmounts({ feeAmount, previousDue, discount, paidAmount, dueDate }) {
  const total = clampNonNegative(addMoney(feeAmount, previousDue) - money(discount));
  const paid = money(paidAmount);
  const remaining = clampNonNegative(total - paid);
  if (remaining <= 0) return { status: 'Paid', remainingDue: 0, totalDue: total };
  if (paid > 0) return { status: 'Partial', remainingDue: remaining, totalDue: total };
  if (dueDate && new Date(dueDate) < startOfToday()) {
    return { status: 'Overdue', remainingDue: remaining, totalDue: total };
  }
  return { status: 'Due', remainingDue: remaining, totalDue: total };
}

export function coachStatusFromAmounts({ netPayable, paidAmount }) {
  const net = money(netPayable);
  const paid = money(paidAmount);
  const remaining = clampNonNegative(net - paid);
  if (remaining <= 0 && net > 0) return { status: 'Paid', remainingAmount: 0 };
  if (paid > 0 && remaining > 0) return { status: 'Partial', remainingAmount: remaining };
  if (net <= 0 && paid <= 0) return { status: 'Pending', remainingAmount: 0 };
  return { status: 'Pending', remainingAmount: remaining };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthLabel(month, year) {
  return `${MONTH_NAMES[month] || month} ${year}`;
}

export function parseMonthYear(month, year) {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new ApiError(400, 'Invalid month');
  }
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new ApiError(400, 'Invalid year');
  }
  return { month: m, year: y };
}
