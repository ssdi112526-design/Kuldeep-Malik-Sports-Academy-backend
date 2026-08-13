import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { connectDB } from './config/db.js';
import { restoreUploadsFromSeedMedia } from './utils/restoreUploads.js';
import { startBackgroundMediaRestore } from './utils/mediaBlobStore.js';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Fast local seed restore (no Postgres BYTEA) — safe before listen
    try {
      restoreUploadsFromSeedMedia();
    } catch (err) {
      console.warn('[uploads] seed-media restore failed:', err.message);
    }

    await connectDB();

    // Listen first — do not block API on large media restore
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
      // Background: restore only referenced missing files from Postgres
      startBackgroundMediaRestore({ onlyReferenced: true });
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();
