/** Player attendance status — internal keys + display labels */

export const ATTENDANCE_STATUSES = [
  { key: 'present', label: 'Present' },
  { key: 'absent', label: 'Absent' },
  { key: 'leave', label: 'Leave' },
  { key: 'medical_leave', label: 'Medical Leave' },
  { key: 'competition_leave', label: 'Competition Leave' },
];

export const ATTENDANCE_STATUS_KEYS = ATTENDANCE_STATUSES.map((s) => s.key);

export const ATTENDANCE_STATUS_LABELS = Object.fromEntries(
  ATTENDANCE_STATUSES.map((s) => [s.key, s.label])
);

/** Excused leave types — excluded from attendance % denominator */
export const EXCUSED_ATTENDANCE_STATUSES = new Set(['leave', 'medical_leave', 'competition_leave']);

export function normalizeAttendanceStatus(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (raw === 'medical' || raw === 'medicalleave') return 'medical_leave';
  if (raw === 'competition' || raw === 'competitionleave') return 'competition_leave';
  if (ATTENDANCE_STATUS_KEYS.includes(raw)) return raw;
  return null;
}

export function attendanceStatusLabel(status) {
  const key = normalizeAttendanceStatus(status) || String(status || '').toLowerCase();
  return ATTENDANCE_STATUS_LABELS[key] || (key ? String(status) : 'Absent');
}

/**
 * Percentage rule:
 * - Present counts as present
 * - Absent counts as absent (unexcused)
 * - Leave / Medical Leave / Competition Leave are excused (not Present, not Absent)
 * - % = Present / (Present + Absent)  [= Present / (TrainingDays − ExcusedLeaveDays)]
 */
export function isExcusedAttendanceStatus(status) {
  const key = normalizeAttendanceStatus(status);
  return key ? EXCUSED_ATTENDANCE_STATUSES.has(key) : false;
}
