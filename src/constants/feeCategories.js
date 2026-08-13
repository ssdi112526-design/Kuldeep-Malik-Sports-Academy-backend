export const FEE_CATEGORIES = [
  { key: 'Monthly', label: 'Monthly Fees' },
  { key: 'Hostel', label: 'Hostel Fees' },
  { key: 'Other', label: 'Other Fees' },
];

export const FEE_CATEGORY_KEYS = FEE_CATEGORIES.map((c) => c.key);

export function normalizeFeeCategory(value, fallback = 'Monthly') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const hit = FEE_CATEGORY_KEYS.find((k) => k.toLowerCase() === raw.toLowerCase());
  return hit || fallback;
}

export function feeCategoryLabel(value) {
  const key = normalizeFeeCategory(value);
  return FEE_CATEGORIES.find((c) => c.key === key)?.label || key;
}

/** Default amount field on Student for a category */
export function studentDefaultFeeField(category) {
  const key = normalizeFeeCategory(category);
  if (key === 'Hostel') return 'hostelFee';
  if (key === 'Other') return 'otherFee';
  return 'monthlyFee';
}
