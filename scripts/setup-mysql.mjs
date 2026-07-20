import { getPool } from "../server/db.mjs";

const pool = await getPool();
const connection = await pool.getConnection();

try {
  const [databaseRows] = await connection.query("SELECT DATABASE() AS databaseName");
  const [tableRows] = await connection.query("SHOW TABLES");
  console.log(`MySQL database ready: ${databaseRows[0]?.databaseName}`);
  console.log(`Tables: ${tableRows.length}`);
} finally {
  connection.release();
  await pool.end();
}
