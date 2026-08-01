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

const allowedOrigins = (
  process.env.CLIENT_URL ||
  'http://localhost:5173,https://www.kartikemi.com,https://kartikemi.com'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }
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

app.use(notFound);
app.use(errorHandler);

export default app;
