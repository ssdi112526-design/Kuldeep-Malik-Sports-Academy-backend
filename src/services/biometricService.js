/**
 * Biometric adapter layer — vendor-agnostic.
 * Default adapter: generic_http (device/sync agent POSTs events to our API).
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import {
  markStudentPresent,
  markCoachPresentRecord,
  resolvePersonByBiometricUserId,
} from './attendanceMarkService.js';

export function hashDeviceSecret(plain) {
  return bcrypt.hash(plain, 12);
}

export async function verifyDeviceSecret(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(String(plain), hash);
}

export function generateDeviceSecret() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Process one biometric punch event from an authorized device.
 * Dedupes by (deviceId, deviceLogId) when deviceLogId provided.
 */
export async function processBiometricEvent({
  device,
  biometricUserId,
  eventAt = new Date(),
  deviceLogId = null,
  rawPayload = null,
} = {}) {
  if (!device?.isEnabled || device.status === 'disabled') {
    throw new ApiError(403, 'Biometric device is disabled.');
  }

  const bioId = String(biometricUserId || '').trim();
  if (!bioId) throw new ApiError(400, 'biometricUserId is required');

  const at = new Date(eventAt);
  if (Number.isNaN(at.getTime())) throw new ApiError(400, 'Invalid event timestamp');

  // Deduplicate device logs
  if (deviceLogId) {
    const existingLog = await prisma.biometricDeviceLog.findUnique({
      where: {
        deviceId_deviceLogId: { deviceId: device.id, deviceLogId: String(deviceLogId) },
      },
    });
    if (existingLog) {
      return { status: 'duplicate', log: existingLog, attendance: null };
    }
  }

  const resolved = await resolvePersonByBiometricUserId(bioId);
  if (!resolved) {
    const log = await prisma.biometricDeviceLog.create({
      data: {
        deviceId: device.id,
        deviceLogId: deviceLogId ? String(deviceLogId) : null,
        biometricUserId: bioId,
        eventAt: at,
        rawPayload: rawPayload || undefined,
        status: 'unknown',
        message: 'Biometric user is not registered. Please contact administrator.',
      },
    });
    await prisma.biometricDevice.update({
      where: { id: device.id },
      data: { lastSyncAt: new Date(), status: 'online', lastError: null },
    });
    return { status: 'unknown', log, attendance: null };
  }

  try {
    let marked;
    if (resolved.personType === 'student') {
      marked = await markStudentPresent({
        studentId: resolved.person.id,
        method: 'BIOMETRIC',
        markedAt: at,
        deviceId: device.id,
        biometricUserId: bioId,
      });
    } else {
      marked = await markCoachPresentRecord({
        coachId: resolved.person.id,
        method: 'BIOMETRIC',
        markedAt: at,
        deviceId: device.id,
        biometricUserId: bioId,
      });
    }

    const log = await prisma.biometricDeviceLog.create({
      data: {
        deviceId: device.id,
        deviceLogId: deviceLogId ? String(deviceLogId) : `auto-${marked.record.id}`,
        biometricUserId: bioId,
        eventAt: at,
        rawPayload: rawPayload || undefined,
        status: 'processed',
        message: 'Attendance marked',
        personType: resolved.personType,
        personId: resolved.person.id,
      },
    });

    await prisma.biometricDevice.update({
      where: { id: device.id },
      data: { lastSyncAt: new Date(), status: 'online', lastError: null },
    });

    return { status: 'processed', log, attendance: marked };
  } catch (err) {
    const isDup = err?.code === 'ATTENDANCE_ALREADY_MARKED' || err?.statusCode === 409;
    const log = await prisma.biometricDeviceLog.create({
      data: {
        deviceId: device.id,
        deviceLogId: deviceLogId ? String(deviceLogId) : `dup-${Date.now()}`,
        biometricUserId: bioId,
        eventAt: at,
        rawPayload: rawPayload || undefined,
        status: isDup ? 'duplicate' : 'error',
        message: err.message || 'Failed',
        personType: resolved.personType,
        personId: resolved.person.id,
      },
    });
    await prisma.biometricDevice.update({
      where: { id: device.id },
      data: {
        lastSyncAt: new Date(),
        status: isDup ? 'online' : 'error',
        lastError: isDup ? null : String(err.message || '').slice(0, 500),
      },
    });
    if (isDup) return { status: 'duplicate', log, attendance: null, error: err };
    throw err;
  }
}

/** Lightweight connection test — marks device online if enabled. */
export async function testDeviceConnection(deviceId) {
  const device = await prisma.biometricDevice.findUnique({ where: { id: deviceId } });
  if (!device) throw new ApiError(404, 'Device not found');
  if (!device.isEnabled) {
    await prisma.biometricDevice.update({
      where: { id: device.id },
      data: { status: 'disabled', lastError: 'Device is disabled' },
    });
    return { ok: false, status: 'disabled', message: 'Device is disabled' };
  }
  // Generic adapter: we cannot ping proprietary hardware from cloud without agent.
  // Mark as online after successful admin test handshake.
  await prisma.biometricDevice.update({
    where: { id: device.id },
    data: { status: 'online', lastSyncAt: new Date(), lastError: null },
  });
  return {
    ok: true,
    status: 'online',
    message:
      'Device record OK. For LAN fingerprint machines, run the on-site sync agent to push punches to /api/biometric/ingest.',
    adapterKey: device.adapterKey,
  };
}
