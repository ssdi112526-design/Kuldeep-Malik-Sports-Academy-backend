import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { writeAuditLog } from '../utils/rbac.js';
import { withId, withIds } from '../utils/serialize.js';
import {
  generateDeviceSecret,
  hashDeviceSecret,
  verifyDeviceSecret,
  processBiometricEvent,
  testDeviceConnection,
} from '../services/biometricService.js';
import { assertBiometricIdAvailable } from '../services/attendanceMarkService.js';

function publicDevice(device, { includeSecretHint = false } = {}) {
  if (!device) return null;
  const { apiSecretHash, ...rest } = device;
  return {
    ...withId(rest),
    hasSecret: Boolean(apiSecretHash),
    ...(includeSecretHint ? {} : {}),
  };
}

export const listBiometricDevices = asyncHandler(async (req, res) => {
  const devices = await prisma.biometricDevice.findMany({ orderBy: { name: 'asc' } });
  res.json({ success: true, data: { devices: devices.map((d) => publicDevice(d)) } });
});

export const getBiometricDevice = asyncHandler(async (req, res) => {
  const device = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!device) throw new ApiError(404, 'Device not found');
  res.json({ success: true, data: { device: publicDevice(device) } });
});

export const createBiometricDevice = asyncHandler(async (req, res) => {
  const {
    name,
    deviceType = 'fingerprint',
    ipAddress,
    port = 4370,
    location,
    serialNumber,
    adapterKey = 'generic_http',
    isEnabled = true,
  } = req.body;

  if (!name?.trim()) throw new ApiError(400, 'Device name is required');

  const plainSecret = generateDeviceSecret();
  const apiSecretHash = await hashDeviceSecret(plainSecret);

  const device = await prisma.biometricDevice.create({
    data: {
      name: String(name).trim(),
      deviceType: String(deviceType || 'fingerprint').trim(),
      ipAddress: ipAddress ? String(ipAddress).trim() : null,
      port: Number(port) || 4370,
      location: location ? String(location).trim() : null,
      serialNumber: serialNumber ? String(serialNumber).trim() : null,
      adapterKey: String(adapterKey || 'generic_http').trim(),
      apiSecretHash,
      isEnabled: Boolean(isEnabled),
      status: Boolean(isEnabled) ? 'offline' : 'disabled',
    },
  });

  await writeAuditLog({
    userId: req.user.id,
    action: 'biometric_device_create',
    entity: 'biometric_device',
    entityId: device.id,
    req,
  });

  res.status(201).json({
    success: true,
    message: 'Device created. Save the API secret — it will not be shown again.',
    data: {
      device: publicDevice(device),
      apiSecret: plainSecret,
    },
  });
});

export const updateBiometricDevice = asyncHandler(async (req, res) => {
  const existing = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Device not found');

  const data = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim();
  if (req.body.deviceType !== undefined) data.deviceType = String(req.body.deviceType).trim();
  if (req.body.ipAddress !== undefined) data.ipAddress = req.body.ipAddress ? String(req.body.ipAddress).trim() : null;
  if (req.body.port !== undefined) data.port = Number(req.body.port) || 4370;
  if (req.body.location !== undefined) data.location = req.body.location ? String(req.body.location).trim() : null;
  if (req.body.serialNumber !== undefined) {
    data.serialNumber = req.body.serialNumber ? String(req.body.serialNumber).trim() : null;
  }
  if (req.body.adapterKey !== undefined) data.adapterKey = String(req.body.adapterKey).trim();
  if (req.body.isEnabled !== undefined) {
    data.isEnabled = Boolean(req.body.isEnabled);
    data.status = data.isEnabled ? existing.status === 'disabled' ? 'offline' : existing.status : 'disabled';
  }

  let rotatedSecret = null;
  if (req.body.rotateSecret) {
    rotatedSecret = generateDeviceSecret();
    data.apiSecretHash = await hashDeviceSecret(rotatedSecret);
  }

  const device = await prisma.biometricDevice.update({ where: { id: existing.id }, data });

  await writeAuditLog({
    userId: req.user.id,
    action: 'biometric_device_update',
    entity: 'biometric_device',
    entityId: device.id,
    req,
  });

  res.json({
    success: true,
    message: rotatedSecret ? 'Device updated. New API secret issued.' : 'Device updated',
    data: {
      device: publicDevice(device),
      ...(rotatedSecret ? { apiSecret: rotatedSecret } : {}),
    },
  });
});

export const deleteBiometricDevice = asyncHandler(async (req, res) => {
  const existing = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new ApiError(404, 'Device not found');
  await prisma.biometricDevice.delete({ where: { id: existing.id } });
  await writeAuditLog({
    userId: req.user.id,
    action: 'biometric_device_delete',
    entity: 'biometric_device',
    entityId: existing.id,
    req,
  });
  res.json({ success: true, message: 'Device deleted' });
});

export const testBiometricDevice = asyncHandler(async (req, res) => {
  const result = await testDeviceConnection(req.params.id);
  res.json({ success: true, data: result });
});

/** Mark syncing + ready for agent pull/push (generic_http has no remote pull). */
export const syncBiometricDeviceNow = asyncHandler(async (req, res) => {
  const device = await prisma.biometricDevice.findUnique({ where: { id: req.params.id } });
  if (!device) throw new ApiError(404, 'Device not found');
  if (!device.isEnabled) throw new ApiError(400, 'Device is disabled');

  await prisma.biometricDevice.update({
    where: { id: device.id },
    data: { status: 'syncing', lastError: null },
  });

  const updated = await prisma.biometricDevice.update({
    where: { id: device.id },
    data: { status: 'online', lastSyncAt: new Date() },
  });

  res.json({
    success: true,
    message:
      'Sync handshake recorded. On-site sync agent should POST pending punches to /api/biometric/ingest with this device id and API secret.',
    data: {
      device: publicDevice(updated),
      ingestPath: '/api/biometric/ingest',
      headers: ['X-Device-Id', 'X-Device-Secret'],
    },
  });
});

export const listBiometricDeviceLogs = asyncHandler(async (req, res) => {
  const deviceId = req.params.id;
  const status = req.query.status ? String(req.query.status) : undefined;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  const logs = await prisma.biometricDeviceLog.findMany({
    where: {
      deviceId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json({ success: true, data: { logs: withIds(logs) } });
});

export const listUnknownBiometricLogs = asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const logs = await prisma.biometricDeviceLog.findMany({
    where: { status: 'unknown' },
    include: { device: { select: { id: true, name: true, location: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json({ success: true, data: { logs: withIds(logs) } });
});

/**
 * Device / sync-agent ingest endpoint.
 * Auth: Authorization: Bearer <deviceApiSecret>  OR  X-Device-Id + X-Device-Secret
 * Body: { biometricUserId, eventAt?, deviceLogId?, events?: [] }
 */
export const ingestBiometricEvents = asyncHandler(async (req, res) => {
  const deviceId = req.headers['x-device-id'] || req.body.deviceId;
  const secret =
    req.headers['x-device-secret'] ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null) ||
    req.body.apiSecret;

  if (!deviceId || !secret) {
    throw new ApiError(401, 'Device credentials required (X-Device-Id + X-Device-Secret).');
  }

  const device = await prisma.biometricDevice.findUnique({ where: { id: String(deviceId) } });
  if (!device || !(await verifyDeviceSecret(secret, device.apiSecretHash))) {
    throw new ApiError(401, 'Invalid device credentials.');
  }

  const events = Array.isArray(req.body.events)
    ? req.body.events
    : [
        {
          biometricUserId: req.body.biometricUserId,
          eventAt: req.body.eventAt || req.body.timestamp,
          deviceLogId: req.body.deviceLogId || req.body.logId,
          rawPayload: req.body,
        },
      ];

  if (!events.length) throw new ApiError(400, 'No biometric events provided');

  const results = [];
  for (const ev of events) {
    try {
      const out = await processBiometricEvent({
        device,
        biometricUserId: ev.biometricUserId,
        eventAt: ev.eventAt || new Date(),
        deviceLogId: ev.deviceLogId || ev.logId || null,
        rawPayload: ev,
      });
      results.push({
        status: out.status,
        biometricUserId: ev.biometricUserId,
        personType: out.attendance?.person?.type || null,
        personName: out.attendance?.person?.name || null,
        time: out.attendance?.time || null,
        method: out.attendance?.method || null,
        message:
          out.status === 'unknown'
            ? 'Biometric user is not registered. Please contact administrator.'
            : out.status === 'duplicate'
              ? 'Already marked / already synced'
              : 'Attendance marked',
      });
    } catch (err) {
      results.push({
        status: 'error',
        biometricUserId: ev.biometricUserId,
        message: err.message || 'Failed',
      });
    }
  }

  res.json({
    success: true,
    message: 'Biometric events processed',
    data: { results },
  });
});

export const setStudentBiometricId = asyncHandler(async (req, res) => {
  const student = await prisma.student.findUnique({ where: { id: req.params.id } });
  if (!student) throw new ApiError(404, 'Student not found');
  const raw = req.body.biometricUserId;
  const next =
    raw === null || raw === undefined || String(raw).trim() === ''
      ? null
      : await assertBiometricIdAvailable(String(raw).trim(), { excludeStudentId: student.id });

  const updated = await prisma.student.update({
    where: { id: student.id },
    data: { biometricUserId: next },
    select: { id: true, fullName: true, registrationNumber: true, biometricUserId: true },
  });
  res.json({ success: true, message: 'Biometric ID saved', data: { student: withId(updated) } });
});

export const setCoachBiometricId = asyncHandler(async (req, res) => {
  const coach = await prisma.coach.findUnique({ where: { id: req.params.id } });
  if (!coach) throw new ApiError(404, 'Coach not found');
  const raw = req.body.biometricUserId;
  const next =
    raw === null || raw === undefined || String(raw).trim() === ''
      ? null
      : await assertBiometricIdAvailable(String(raw).trim(), { excludeCoachId: coach.id });

  const updated = await prisma.coach.update({
    where: { id: coach.id },
    data: { biometricUserId: next },
    select: { id: true, fullName: true, coachCode: true, biometricUserId: true },
  });
  res.json({ success: true, message: 'Biometric ID saved', data: { coach: withId(updated) } });
});
