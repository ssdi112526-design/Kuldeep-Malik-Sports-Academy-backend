import path from 'path';
import QRCode from 'qrcode';
import { QR_DIR, toPublicPath } from '../middleware/upload.js';

export async function generateQrPng(text, filenamePrefix = 'qr') {
  if (!text) return null;
  if (!QR_DIR) return null;

  const safePrefix = String(filenamePrefix || 'qr').replace(/[^a-z0-9-_]/gi, '');
  const filename = `${safePrefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}.png`;
  const absolute = path.join(QR_DIR, filename);

  await QRCode.toFile(absolute, text, {
    type: 'png',
    width: 420,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  return toPublicPath(filename, 'qr');
}

