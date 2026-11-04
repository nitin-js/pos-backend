import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

const cors = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:5174,http://localhost:5175")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required("MONGODB_URI", "mongodb://localhost:27017"),
  mongoDb: required("MONGODB_DB_NAME", "pos-db"),
  accessSecret: required("JWT_ACCESS_SECRET", "dev-access-secret-change-before-production"),
  refreshSecret: required("JWT_REFRESH_SECRET", "dev-refresh-secret-change-before-production"),
  corsOrigins: cors,
  expectedMigration: "20261104214500-fix-sparse-unique-indexes.js",
  isProduction: process.env.NODE_ENV === "production",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
};
