import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { connectDB } from './config/db.js';
import { restoreUploadsFromSeedMedia } from './utils/restoreUploads.js';
import { restoreMediaBlobsFromDb } from './utils/mediaBlobStore.js';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Render ephemeral disk: restore committed seed-media first
    try {
      restoreUploadsFromSeedMedia();
    } catch (err) {
      console.warn('[uploads] seed-media restore failed:', err.message);
    }

    await connectDB();

    // Then restore admin uploads backed up in Postgres (survives redeploy)
    try {
      await restoreMediaBlobsFromDb();
    } catch (err) {
      console.warn('[media-blob] DB restore failed:', err.message);
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

