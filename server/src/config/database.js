import mongoose from "mongoose";
import { logger } from "./logger.js";

const sanitizeUri = (uri) => {
  if (!uri) return "";
  try {
    return uri.replace(/\/\/(.*):(.*)@/, "//***:***@");
  } catch (err) {
    return "[REDACTED_URI]";
  }
};

export const getDatabaseStatus = () => {
  const state = mongoose.connection.readyState;
  switch (state) {
    case 0:
      return "disconnected";
    case 1:
      return "connected";
    case 2:
      return "connecting";
    case 3:
      return "disconnecting";
    default:
      return "unknown";
  }
};

export const connectDatabase = async (customUri) => {
  const uri = customUri || process.env.MONGODB_URI;

  if (!uri) {
    logger.warn("⚠️ MONGODB_URI is not provided. Skipping database connection.");
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    logger.info("MongoDB is already connected.");
    return true;
  }

  try {
    const safeUri = sanitizeUri(uri);
    logger.info(`Connecting to MongoDB (${safeUri})...`);
    
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });

    logger.info("✅ MongoDB connected successfully.");
    return true;
  } catch (error) {
    logger.error(`❌ MongoDB connection error: ${error.message}`);
    throw error;
  }
};

export const disconnectDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
      logger.info("MongoDB disconnected successfully.");
    } catch (error) {
      logger.error(`Error disconnecting MongoDB: ${error.message}`);
    }
  }
};
