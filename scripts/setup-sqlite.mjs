import { getDatabasePath, getPool, getUserCount } from "../server/db.mjs";

const db = await getPool();

try {
  console.log(`SQLite database ready: ${getDatabasePath()}`);
  console.log(`Users: ${await getUserCount()}`);
} finally {
  await db.close();
}
