import { app } from "./app";
import { config } from "./config";
import { connectDb } from "./db";
import { logger } from "./logger";

connectDb().then(() => {
  app.listen(config.port, () => {
    logger.info({ port: config.port, db: config.mongoDb }, "API listening");
  });
}).catch((error) => {
  logger.error({ err: error }, "API failed to start");
  process.exit(1);
});
