/** Server-side gallery achievement helpers */

export const GALLERY_ACHIEVEMENT_TYPES = [
  'none',
  'gold',
  'silver',
  'bronze',
  'champion',
  'national',
  'state',
  'winner',
];

const DEFAULT_LABELS = {
  gold: 'Gold Medalist',
  silver: 'Silver Medalist',
  bronze: 'Bronze Medalist',
  champion: 'Champion',
  national: 'National Medalist',
  state: 'State Medalist',
  winner: 'Competition Winner',
};

export function normalizeAchievementType(value) {
  const key = String(value || 'none').trim().toLowerCase();
  return GALLERY_ACHIEVEMENT_TYPES.includes(key) ? key : 'none';
}

export function normalizeAchievementLabel(type, label) {
  const t = normalizeAchievementType(type);
  if (t === 'none') return null;
  const cleaned = String(label || '').trim();
  if (cleaned) return cleaned.slice(0, 80);
  return DEFAULT_LABELS[t] || null;
}
