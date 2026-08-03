/** Asia/Kolkata attendance date helpers (date-only as UTC midnight). */

import { n0 } from './zeroEmpty.js';

const TZ = 'Asia/Kolkata';

const DAY_KEY_BY_UTC = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

export function dateKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Parse YYYY-MM-DD → Date at UTC midnight (calendar date, not shifted). */
export function parseDateOnly(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('Invalid date. Use YYYY-MM-DD');
  }
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
  return d;
}

/** Current calendar date in Asia/Kolkata as UTC-midnight Date. */
export function todayISTDateOnly(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

/** Attendance date for a scan timestamp, in Asia/Kolkata. */
export function attendanceDateFromInstant(instant = new Date()) {
  return todayISTDateOnly(instant);
}

export function monthBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) throw new Error('Invalid year/month');
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return { from, to };
}

export function currentMonthBoundsIST(now = new Date()) {
  const today = todayISTDateOnly(now);
  return monthBounds(today.getUTCFullYear(), today.getUTCMonth() + 1);
}

/** Cap end date so future training days are not counted as absent. */
export function effectivePeriodEnd(toDate, now = new Date()) {
  const today = todayISTDateOnly(now);
  if (!toDate) return today;
  return toDate.getTime() > today.getTime() ? today : toDate;
}

export function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

export function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/** Normalize joiningDate (may be datetime) to UTC date-only. */
export function toDateOnly(d) {
  if (!d) return null;
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/**
 * trainingDaySet: Set of dayKeys that ARE training days (not holidays).
 * Defaults to Mon–Sat when empty.
 */
export function listTrainingDates(fromDate, toDate, trainingDayKeys) {
  if (!fromDate || !toDate || fromDate.getTime() > toDate.getTime()) return [];
  const keys =
    trainingDayKeys && trainingDayKeys.size
      ? trainingDayKeys
      : new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);

  const out = [];
  const cur = new Date(fromDate);
  const end = new Date(toDate);
  while (cur.getTime() <= end.getTime()) {
    const key = DAY_KEY_BY_UTC[cur.getUTCDay()];
    if (keys.has(key)) out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function countTrainingDates(fromDate, toDate, trainingDayKeys) {
  return listTrainingDates(fromDate, toDate, trainingDayKeys).length;
}

/** Round to max 2 decimal places. */
export function pct2(present, total) {
  const p = n0(present);
  const t = n0(total);
  if (!t) return 0;
  return Math.round((p / t) * 10000) / 100;
}

export { DAY_KEY_BY_UTC, TZ as ATTENDANCE_TZ };
