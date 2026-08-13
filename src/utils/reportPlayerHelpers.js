/** Shared player report helpers — Khelo match + age/weight category resolution */

const KHELO_RE = /khelo/i;

/** Freestyle-style fallback weight classes (kg upper bounds) */
export const WEIGHT_CLASS_BOUNDS = [57, 61, 65, 70, 74, 79, 86, 92, 97, 125];

/** Age band fallbacks when ageCategory is empty */
export function ageFromDobOrField(student, now = new Date()) {
  if (student?.age != null && Number(student.age) > 0) return Number(student.age);
  if (!student?.dateOfBirth) return null;
  const dob = new Date(student.dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function fallbackAgeCategory(student, now = new Date()) {
  const age = ageFromDobOrField(student, now);
  if (age == null) return 'Unspecified';
  if (age < 15) return 'U15';
  if (age < 17) return 'U17';
  if (age < 20) return 'U20';
  if (age < 23) return 'U23';
  return 'Senior';
}

export function fallbackWeightCategory(student) {
  const w = Number(student?.weightKg) || 0;
  if (w <= 0) return 'Unspecified';
  for (const bound of WEIGHT_CLASS_BOUNDS) {
    if (w <= bound) return `${bound} KG`;
  }
  return '125+ KG';
}

export function isKheloIndia(student) {
  const cat = String(student?.category || '');
  const mem = String(student?.membershipType || '');
  return KHELO_RE.test(cat) || KHELO_RE.test(mem);
}

export function resolveAgeCategory(student, now = new Date()) {
  const manual = String(student?.ageCategory || '').trim();
  if (manual) return manual;
  return fallbackAgeCategory(student, now);
}

export function resolveWeightCategory(student) {
  const manual = String(student?.weightCategory || '').trim();
  if (manual) return manual;
  return fallbackWeightCategory(student);
}

export function resolvePlayerCategory(student) {
  const cat = String(student?.category || '').trim();
  if (cat) return cat;
  return 'Unspecified';
}

export function kheloWhere() {
  return {
    OR: [
      { category: { contains: 'Khelo', mode: 'insensitive' } },
      { membershipType: { contains: 'Khelo', mode: 'insensitive' } },
    ],
  };
}

export function formatDateIN(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN');
}
