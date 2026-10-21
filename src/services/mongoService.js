import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

let isConnected = false;

export async function connectMongo() {
  if (isConnected) return;

  const uri = config.mongo.uri;
  if (!uri) {
    throw new Error('MONGODB_URI is not set in environment variables');
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS:          45_000
    });

    isConnected = true;
    logger.success(`MongoDB connected: ${mongoose.connection.host}`);

    // SessionSnapshot used to be unique per guild; it is now unique per (bot, guild) so a second bot can share the
    // database. syncIndexes() drops the old index and builds the new one — it only touches THIS collection's indexes.
    try {
      const { SessionSnapshot } = await import('../models/SessionSnapshot.js');
      await SessionSnapshot.syncIndexes();
    } catch (err) {
      logger.warn('SessionSnapshot index sync failed:', err.message);
    }

    mongoose.connection.on('error', err => {
      logger.error('MongoDB error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected — attempting reconnect...');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      logger.success('MongoDB reconnected');
      isConnected = true;
    });

  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    // The two usual causes on a hosting panel: a wrong MONGODB_URI (user/password/db name), or Atlas refusing the host's IP.
    logger.error('↳ Check MONGODB_URI, and in MongoDB Atlas → Network Access allow the host (0.0.0.0/0 if its IP changes).');
    logger.error('↳ تحقق من MONGODB_URI، وفي Atlas ← Network Access اسمح بعنوان الاستضافة (0.0.0.0/0 إذا كان عنوانها يتغيّر).');
    throw err;
  }
}

export function getMongoStatus() {
  return {
    connected: isConnected,
    state:     mongoose.connection.readyState
  };
}
