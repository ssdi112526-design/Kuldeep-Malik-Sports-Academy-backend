import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/authRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import contentRoutes from './routes/contentRoutes.js';
import indexRoutes from './routes/index.js';
import errorHandler, { notFound } from './middleware/errorHandler.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api', indexRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/content', contentRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
