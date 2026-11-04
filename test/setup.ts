process.env.MONGODB_DB_NAME = process.env.MONGODB_DB_NAME_TEST || "pos-db-test";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-change-me";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-change-me";
process.env.NODE_ENV = "test";
