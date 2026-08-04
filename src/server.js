import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { connectDB } from './config/db.js';
import { restoreUploadsFromSeedMedia } from './utils/restoreUploads.js';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Render ephemeral disk: restore media snapshot after every redeploy
    try {
      restoreUploadsFromSeedMedia();
    } catch (err) {
      console.warn('[uploads] restore failed:', err.message);
    }

    await connectDB();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

