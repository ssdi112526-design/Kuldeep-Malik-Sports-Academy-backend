/** Stored medal values for player achievements / tournament results */

export const MEDAL_OPTIONS = [
  { key: 'Gold', label: 'Gold' },
  { key: 'Silver', label: 'Silver' },
  { key: 'Bronze', label: 'Bronze' },
  { key: 'Other', label: 'None' },
];

export const MEDAL_KEYS = MEDAL_OPTIONS.map((m) => m.key);

export function normalizeMedal(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'gold' || lower === '1st' || lower === 'first') return 'Gold';
  if (lower === 'silver' || lower === '2nd' || lower === 'second') return 'Silver';
  if (lower === 'bronze' || lower === '3rd' || lower === 'third') return 'Bronze';
  if (lower === 'none' || lower === 'other' || lower === 'custom') return 'Other';
  // Preserve custom labels as Other display path, but keep text if already title-cased custom
  if (MEDAL_KEYS.includes(raw)) return raw;
  return raw.length > 40 ? raw.slice(0, 40) : raw;
}

export function medalBadgeType(value) {
  const n = normalizeMedal(value);
  if (n === 'Gold' || n === 'Silver' || n === 'Bronze') return n.toLowerCase();
  return n ? 'other' : null;
}
