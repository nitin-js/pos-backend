import { connectDb, closeDb } from "./db";
import { assertSeedDatabase, ensureBusinessAdmin, ensureSuperAdmin, printAccounts } from "./seed-accounts";

assertSeedDatabase();

connectDb().then(async () => {
  const superAdmin = await ensureSuperAdmin();
  const businessAdmin = await ensureBusinessAdmin();
  printAccounts(superAdmin, businessAdmin);
  await closeDb();
  process.exit(0);
}).catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
