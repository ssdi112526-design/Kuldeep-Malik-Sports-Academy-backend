/**
 * Empty / null / blank → 0 for counts, stats, and Excel cells.
 * Keeps real 0 as 0. Does not convert meaningful text like "Present".
 */

export function n0(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const s = String(value).trim();
  if (!s || s === '—' || s === '-' || s === 'N/A' || s === 'n/a' || s === 'null') return 0;
  const n = Number(s.replace(/%/g, ''));
  if (Number.isFinite(n) && /^-?\d+(\.\d+)?%?$/.test(s.replace(/\s/g, ''))) return n;
  // Non-numeric text stays as-is for names/status; callers use cell0 for Excel blanks
  return value;
}

/** For Excel: empty / dash / null → 0; otherwise keep value (numbers coerced). */
export function cell0(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value).trim();
  if (!s || s === '—' || s === '-' || s === 'N/A' || s === 'n/a' || s === 'null' || s === 'undefined') {
    return 0;
  }
  return value;
}

export function rowZeros(row = {}, keys = null) {
  const out = { ...row };
  const list = keys || Object.keys(out);
  for (const key of list) {
    out[key] = cell0(out[key]);
  }
  return out;
}

export function mapRowsZeros(rows = [], keys = null) {
  return (rows || []).map((r) => rowZeros(r, keys));
}
