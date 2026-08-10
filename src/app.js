import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/authRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import contentRoutes from './routes/contentRoutes.js';
import cmsRoutes from './routes/cmsRoutes.js';
import entryRoutes from './routes/entryRoutes.js';
import uploadSyncRoutes from './routes/uploadSyncRoutes.js';
import rbacRoutes from './routes/rbacRoutes.js';
import scheduleAchievementRoutes from './routes/scheduleAchievementRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import coachAttendanceRoutes from './routes/coachAttendanceRoutes.js';
import coachPortalRoutes from './routes/coachPortalRoutes.js';
import biometricRoutes from './routes/biometricRoutes.js';
import attendanceSettingsRoutes from './routes/attendanceSettingsRoutes.js';
import financeRoutes from './routes/financeRoutes.js';
import indexRoutes from './routes/index.js';
import errorHandler, { notFound } from './middleware/errorHandler.js';
import { UPLOADS_DIR } from './middleware/upload.js';

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://www.kushti.co.in',
  'https://kushti.co.in',
  'https://www.fastsearch.in',
  'https://fastsearch.in',
];

const allowedOrigins = (process.env.CLIENT_URL || defaultOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    // Production brand domain (with/without www)
    if (hostname === 'kushti.co.in' || hostname === 'www.kushti.co.in') return true;
    if (process.env.NODE_ENV !== 'production') {
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
      ) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api', indexRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/content', contentRoutes);
app.use('/api', cmsRoutes);
app.use('/api', entryRoutes);
app.use('/api', uploadSyncRoutes);
app.use('/api', rbacRoutes);
app.use('/api', scheduleAchievementRoutes);
app.use('/api', attendanceRoutes);
app.use('/api', coachAttendanceRoutes);
app.use('/api', coachPortalRoutes);
app.use('/api', biometricRoutes);
app.use('/api', attendanceSettingsRoutes);
app.use('/api', financeRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
