import asyncHandler from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { writeAuditLog } from '../utils/rbac.js';
import {
  getAttendanceLocationSettings,
  upsertAttendanceLocationSettings,
  testLocationAgainstGeofence,
  distanceMeters,
} from '../services/geofenceService.js';

export const getAttendanceSettings = asyncHandler(async (_req, res) => {
  const settings = await getAttendanceLocationSettings();
  res.json({
    success: true,
    data: {
      settings: {
        id: settings.id,
        name: settings.name,
        latitude: settings.latitude,
        longitude: settings.longitude,
        allowedRadiusMeters: settings.allowedRadiusMeters,
        maxGpsAccuracyMeters: settings.maxGpsAccuracyMeters,
        isEnabled: settings.isEnabled,
        configured: settings.latitude != null && settings.longitude != null,
        updatedAt: settings.updatedAt,
      },
    },
  });
});

export const updateAttendanceSettings = asyncHandler(async (req, res) => {
  const settings = await upsertAttendanceLocationSettings(req.body || {});
  await writeAuditLog({
    userId: req.user.id,
    action: 'attendance_location_update',
    entity: 'attendance_location_settings',
    entityId: settings.id,
    details: {
      latitude: settings.latitude,
      longitude: settings.longitude,
      allowedRadiusMeters: settings.allowedRadiusMeters,
      maxGpsAccuracyMeters: settings.maxGpsAccuracyMeters,
      isEnabled: settings.isEnabled,
    },
    req,
  });
  res.json({
    success: true,
    message: 'Attendance location settings saved',
    data: {
      settings: {
        id: settings.id,
        name: settings.name,
        latitude: settings.latitude,
        longitude: settings.longitude,
        allowedRadiusMeters: settings.allowedRadiusMeters,
        maxGpsAccuracyMeters: settings.maxGpsAccuracyMeters,
        isEnabled: settings.isEnabled,
        configured: settings.latitude != null && settings.longitude != null,
        updatedAt: settings.updatedAt,
      },
    },
  });
});

export const testAttendanceLocation = asyncHandler(async (req, res) => {
  const { latitude, longitude, accuracy } = req.body || {};
  if (latitude === undefined || longitude === undefined) {
    throw new ApiError(400, 'latitude and longitude are required for Test Location');
  }
  const result = await testLocationAgainstGeofence({ latitude, longitude, accuracy });
  res.json({ success: true, data: result });
});

/** Quick distance helper for admin UI (optional) */
export const previewDistance = asyncHandler(async (req, res) => {
  const settings = await getAttendanceLocationSettings();
  const lat = Number(req.query.latitude ?? req.body?.latitude);
  const lng = Number(req.query.longitude ?? req.body?.longitude);
  if (settings.latitude == null || settings.longitude == null) {
    throw new ApiError(400, 'Akhada location is not configured.');
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(400, 'Valid latitude and longitude required.');
  }
  const distance = distanceMeters(lat, lng, settings.latitude, settings.longitude);
  res.json({
    success: true,
    data: {
      distanceMeters: distance,
      allowedRadiusMeters: settings.allowedRadiusMeters,
      inside: distance <= settings.allowedRadiusMeters,
    },
  });
});

/** Public map coordinates for the website Contact / Location section */
export const getPublicAkhadaLocation = asyncHandler(async (_req, res) => {
  const settings = await getAttendanceLocationSettings();
  const configured = settings.latitude != null && settings.longitude != null;
  res.json({
    success: true,
    data: {
      name: settings.name || 'Raghunandan Akhada',
      latitude: configured ? Number(settings.latitude) : null,
      longitude: configured ? Number(settings.longitude) : null,
      configured,
      updatedAt: settings.updatedAt,
    },
  });
});
