/**
 * GPS geofencing for QR attendance.
 * Academy coordinates live in AttendanceLocationSetting (admin-configured) — never hardcode guesses.
 */
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';

const SETTINGS_ID = 'default';
const MAX_GPS_AGE_MS = 5 * 60 * 1000; // reject stale client timestamps > 5 min

/** Haversine distance in meters */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const R = 6371000;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export async function getAttendanceLocationSettings() {
  let row = await prisma.attendanceLocationSetting.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) {
    row = await prisma.attendanceLocationSetting.create({
      data: {
        id: SETTINGS_ID,
        name: 'Kuldeep Malik Sports Academy',
        allowedRadiusMeters: 500,
        maxGpsAccuracyMeters: 100,
        isEnabled: true,
      },
    });
  }
  return row;
}

export async function upsertAttendanceLocationSettings(input = {}) {
  const existing = await getAttendanceLocationSettings();
  const data = {};

  if (input.name !== undefined) data.name = String(input.name || 'Kuldeep Malik Sports Academy').trim().slice(0, 160);

  if (input.latitude !== undefined) {
    const lat = input.latitude === null || input.latitude === '' ? null : Number(input.latitude);
    if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
      throw new ApiError(400, 'Latitude must be between -90 and 90.');
    }
    data.latitude = lat;
  }
  if (input.longitude !== undefined) {
    const lng = input.longitude === null || input.longitude === '' ? null : Number(input.longitude);
    if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
      throw new ApiError(400, 'Longitude must be between -180 and 180.');
    }
    data.longitude = lng;
  }
  if (input.allowedRadiusMeters !== undefined) {
    const r = Math.round(Number(input.allowedRadiusMeters));
    if (!Number.isFinite(r) || r < 50 || r > 5000) {
      throw new ApiError(400, 'Allowed radius must be between 50 and 5000 meters.');
    }
    data.allowedRadiusMeters = r;
  }
  if (input.maxGpsAccuracyMeters !== undefined) {
    const a = Math.round(Number(input.maxGpsAccuracyMeters));
    if (!Number.isFinite(a) || a < 10 || a > 1000) {
      throw new ApiError(400, 'Max GPS accuracy must be between 10 and 1000 meters.');
    }
    data.maxGpsAccuracyMeters = a;
  }
  if (input.isEnabled !== undefined) data.isEnabled = Boolean(input.isEnabled);

  return prisma.attendanceLocationSetting.update({
    where: { id: existing.id },
    data,
  });
}

/**
 * Validate GPS for QR scan. Throws ApiError on failure.
 * Returns geo fields to store on attendance.
 */
export async function assertQrGeofence({
  latitude,
  longitude,
  accuracy,
  timestamp,
  skipIfDisabled = true,
} = {}) {
  const settings = await getAttendanceLocationSettings();

  if (!settings.isEnabled) {
    return {
      skipped: true,
      latitude: null,
      longitude: null,
      gpsAccuracy: null,
      distanceFromAkhada: null,
      locationVerified: null,
      settings,
    };
  }

  if (settings.latitude == null || settings.longitude == null) {
    throw new ApiError(
      503,
      'Academy attendance location is not configured yet.\nPlease ask the administrator to set the location in Attendance Settings.',
      'LOCATION_NOT_CONFIGURED'
    );
  }

  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
    throw new ApiError(
      400,
      'Location unavailable.\nPlease enable GPS/location services and try again.',
      'GPS_REQUIRED'
    );
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new ApiError(400, 'Invalid GPS coordinates.', 'GPS_INVALID');
  }

  if (timestamp) {
    const ts = new Date(timestamp).getTime();
    if (!Number.isNaN(ts)) {
      const age = Math.abs(Date.now() - ts);
      if (age > MAX_GPS_AGE_MS) {
        throw new ApiError(
          400,
          'GPS location is too old.\nPlease refresh location and scan again.',
          'GPS_STALE'
        );
      }
    }
  }

  const acc = accuracy === undefined || accuracy === null || accuracy === '' ? null : Number(accuracy);
  if (acc !== null && Number.isFinite(acc) && acc > settings.maxGpsAccuracyMeters) {
    throw new ApiError(
      400,
      `GPS accuracy is too low (${Math.round(acc)} m).\nPlease move to an open area and try again.`,
      'GPS_ACCURACY_POOR'
    );
  }

  const distance = distanceMeters(lat, lng, settings.latitude, settings.longitude);
  const allowed = settings.allowedRadiusMeters;

  if (distance > allowed) {
    const err = new ApiError(
      403,
      `You are outside the attendance area.\n\nYour distance: ${Math.round(distance)} meters\nAllowed distance: ${allowed} meters\n\nPlease come within the Academy attendance area and try again.`,
      'LOCATION_OUTSIDE_RADIUS'
    );
    err.meta = {
      distanceMeters: distance,
      allowedRadiusMeters: allowed,
      locationVerified: false,
    };
    throw err;
  }

  return {
    skipped: false,
    latitude: lat,
    longitude: lng,
    gpsAccuracy: acc !== null && Number.isFinite(acc) ? acc : null,
    distanceFromAkhada: distance,
    locationVerified: true,
    settings,
  };
}

/** Admin test: compare a point against configured geofence */
export async function testLocationAgainstGeofence({ latitude, longitude, accuracy } = {}) {
  const settings = await getAttendanceLocationSettings();
  if (settings.latitude == null || settings.longitude == null) {
    return {
      ok: false,
      code: 'LOCATION_NOT_CONFIGURED',
      message: 'Save Academy latitude/longitude first.',
      settings,
    };
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, code: 'GPS_INVALID', message: 'Invalid test coordinates.', settings };
  }
  const distance = distanceMeters(lat, lng, settings.latitude, settings.longitude);
  const acc = accuracy == null || accuracy === '' ? null : Number(accuracy);
  const accuracyOk = acc == null || !Number.isFinite(acc) || acc <= settings.maxGpsAccuracyMeters;
  const inside = distance <= settings.allowedRadiusMeters;
  return {
    ok: inside && accuracyOk,
    inside,
    accuracyOk,
    distanceMeters: distance,
    allowedRadiusMeters: settings.allowedRadiusMeters,
    maxGpsAccuracyMeters: settings.maxGpsAccuracyMeters,
    gpsAccuracy: acc,
    locationVerified: inside && accuracyOk,
    message: !accuracyOk
      ? `GPS accuracy too low (${Math.round(acc)} m). Max allowed ${settings.maxGpsAccuracyMeters} m.`
      : inside
        ? `LOCATION VERIFIED — ${Math.round(distance)} m from Academy (within ${settings.allowedRadiusMeters} m).`
        : `LOCATION NOT VERIFIED — ${Math.round(distance)} m from Academy (allowed ${settings.allowedRadiusMeters} m).`,
    settings,
  };
}
