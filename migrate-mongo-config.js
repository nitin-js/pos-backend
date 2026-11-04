require("dotenv").config();

const url = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME;

if (!url || !databaseName) {
  throw new Error("MONGODB_URI and MONGODB_DB_NAME must be set. Copy .env.example to .env.");
}

module.exports = {
  mongodb: {
    url,
    databaseName,
  },
  migrationsDir: "migrations",
  changelogCollectionName: "schema_migrations",
  migrationFileExtension: ".js",
  useFileHash: false,
  moduleSystem: "commonjs",
};
