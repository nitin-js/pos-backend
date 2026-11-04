import { config } from "./config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertLocalDatabase(uri = config.mongoUri, nodeEnv = process.env.NODE_ENV ?? ""): void {
  if (nodeEnv === "production") {
    throw new Error("Refusing to seed: NODE_ENV is production.");
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("Refusing to seed: MONGODB_URI is not a valid URL.");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (parsed.protocol === "mongodb+srv:" || !LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed: ${uri} is not a localhost database.`);
  }
}
