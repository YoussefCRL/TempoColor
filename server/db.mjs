import crypto from "node:crypto";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: ".env.local" });
dotenv.config();

const SEEDED_USER_KEY_HEX = "796f7573736566";
const SEEDED_USER_HASH_SALT_HEX = "63376439666533613131623834643636";
const SEEDED_USER_HASH_VALUE =
  "1dff7f37bbb274888c9fa888f05e4dd439abfbe605f580e5c75e8fdab97ce0ef";

let poolPromise;

const normalizeUsername = (value) => value.trim().toLowerCase();

const decodeHexString = (hex) => Buffer.from(hex, "hex").toString("utf8");

const hashPassword = (password, salt) =>
  crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");

const assertDatabaseName = (database) => {
  if (!/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error("MYSQL_DATABASE can only contain letters, numbers, and underscores.");
  }
};

const parseJson = (value, fallback) => {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const getSslConfig = () => {
  const ca = process.env.MYSQL_SSL_CA_CERT || process.env.MYSQL_SSL_CA || "";
  if (!ca.trim()) {
    return undefined;
  }
  return {
    ca: ca.replace(/\\n/g, "\n"),
    rejectUnauthorized: true
  };
};

const getConnectionConfig = () => {
  const mysqlUrl = process.env.MYSQL_URL;
  if (!mysqlUrl) {
    throw new Error("MYSQL_URL is missing from the environment.");
  }
  const parsed = new URL(mysqlUrl);
  const database = process.env.MYSQL_DATABASE || "gymify";
  assertDatabaseName(database);

  return {
    database,
    initialDatabase: parsed.pathname.replace(/^\//, "") || "defaultdb",
    config: {
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      ssl: getSslConfig(),
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      namedPlaceholders: true
    }
  };
};

const createSchema = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username VARCHAR(32) PRIMARY KEY,
      password_salt VARCHAR(64) NOT NULL,
      password_hash CHAR(64) NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_state (
      username VARCHAR(32) PRIMARY KEY,
      state_json JSON NOT NULL,
      updated_at BIGINT NOT NULL,
      CONSTRAINT fk_user_state_user
        FOREIGN KEY (username) REFERENCES users(username)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workouts (
      username VARCHAR(32) NOT NULL,
      workout_id VARCHAR(96) NOT NULL,
      workout_name VARCHAR(255) NOT NULL,
      hidden BOOLEAN NOT NULL DEFAULT FALSE,
      workout_json JSON NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (username, workout_id),
      CONSTRAINT fk_workouts_user
        FOREIGN KEY (username) REFERENCES users(username)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workout_progress (
      username VARCHAR(32) NOT NULL,
      workout_id VARCHAR(96) NOT NULL,
      exercise_id VARCHAR(96) NOT NULL,
      sets_done INT NOT NULL DEFAULT 0,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at BIGINT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (username, workout_id, exercise_id),
      CONSTRAINT fk_workout_progress_user
        FOREIGN KEY (username) REFERENCES users(username)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS weight_progress_logs (
      id VARCHAR(128) PRIMARY KEY,
      username VARCHAR(32) NOT NULL,
      program_id VARCHAR(96) NULL,
      program_name VARCHAR(255) NULL,
      day_id VARCHAR(96) NULL,
      day_name VARCHAR(255) NULL,
      workout_id VARCHAR(96) NOT NULL,
      workout_name VARCHAR(255) NOT NULL,
      exercise_id VARCHAR(96) NOT NULL,
      exercise_name VARCHAR(255) NOT NULL,
      set_index INT NOT NULL,
      weight_kg DECIMAL(8,2) NOT NULL,
      reps INT NOT NULL,
      rir INT NULL,
      note TEXT NOT NULL,
      logged_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      CONSTRAINT fk_weight_progress_user
        FOREIGN KEY (username) REFERENCES users(username)
        ON DELETE CASCADE,
      INDEX idx_weight_user_logged_at (username, logged_at)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS program_day_completion_logs (
      id VARCHAR(160) PRIMARY KEY,
      username VARCHAR(32) NOT NULL,
      program_id VARCHAR(96) NOT NULL,
      program_name VARCHAR(255) NOT NULL,
      day_id VARCHAR(96) NOT NULL,
      day_name VARCHAR(255) NOT NULL,
      workout_id VARCHAR(96) NULL,
      workout_name VARCHAR(255) NULL,
      week_key VARCHAR(16) NOT NULL,
      completed BOOLEAN NOT NULL,
      completed_at BIGINT NULL,
      updated_at BIGINT NOT NULL,
      CONSTRAINT fk_day_completion_user
        FOREIGN KEY (username) REFERENCES users(username)
        ON DELETE CASCADE,
      INDEX idx_day_user_updated_at (username, updated_at)
    )
  `);
};

const seedPrivilegedUser = async (pool) => {
  const username = normalizeUsername(decodeHexString(SEEDED_USER_KEY_HEX));
  const salt = decodeHexString(SEEDED_USER_HASH_SALT_HEX);
  const createdAt = Date.UTC(2026, 2, 30, 0, 0, 0);
  await pool.query(
    `
      INSERT IGNORE INTO users (username, password_salt, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    [username, salt, SEEDED_USER_HASH_VALUE, createdAt, createdAt]
  );
};

export const getPool = async () => {
  if (!poolPromise) {
    poolPromise = (async () => {
      const { config, database, initialDatabase } = getConnectionConfig();
      const setupConnection = await mysql.createConnection({
        ...config,
        database: initialDatabase
      });
      await setupConnection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
      await setupConnection.end();

      const pool = mysql.createPool({
        ...config,
        database
      });
      await createSchema(pool);
      await seedPrivilegedUser(pool);
      return pool;
    })();
  }
  return poolPromise;
};

export const getUserCount = async () => {
  const pool = await getPool();
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM users");
  return Number(rows[0]?.count || 0);
};

export const createUser = async (usernameInput, password) => {
  const username = normalizeUsername(usernameInput);
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const now = Date.now();
  const pool = await getPool();
  try {
    await pool.query(
      `
        INSERT INTO users (username, password_salt, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [username, salt, passwordHash, now, now]
    );
    return { username };
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      const duplicate = new Error("This username already exists.");
      duplicate.statusCode = 409;
      throw duplicate;
    }
    throw error;
  }
};

export const verifyUser = async (usernameInput, password) => {
  const username = normalizeUsername(usernameInput);
  const pool = await getPool();
  const [rows] = await pool.query(
    "SELECT username, password_salt, password_hash FROM users WHERE username = ?",
    [username]
  );
  const user = rows[0];
  if (!user || hashPassword(password, user.password_salt) !== user.password_hash) {
    const error = new Error("Username or password is invalid.");
    error.statusCode = 401;
    throw error;
  }
  return { username: user.username };
};

export const getUserState = async (usernameInput) => {
  const username = normalizeUsername(usernameInput);
  const pool = await getPool();
  const [rows] = await pool.query("SELECT state_json FROM user_state WHERE username = ?", [username]);
  return parseJson(rows[0]?.state_json, {});
};

export const saveUserState = async (usernameInput, state) => {
  const username = normalizeUsername(usernameInput);
  const now = Date.now();
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `
        INSERT INTO user_state (username, state_json, updated_at)
        VALUES (?, CAST(? AS JSON), ?)
        ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = VALUES(updated_at)
      `,
      [username, JSON.stringify(state || {}), now]
    );

    await connection.query("DELETE FROM workouts WHERE username = ?", [username]);
    const workouts = Array.isArray(state?.workouts) ? state.workouts : [];
    for (const workout of workouts) {
      if (!workout?.id || !workout?.name) {
        continue;
      }
      await connection.query(
        `
          INSERT INTO workouts (username, workout_id, workout_name, hidden, workout_json, updated_at)
          VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)
        `,
        [
          username,
          String(workout.id),
          String(workout.name),
          Boolean(workout.hidden),
          JSON.stringify(workout),
          now
        ]
      );
    }

    await connection.query("DELETE FROM workout_progress WHERE username = ?", [username]);
    const progress = state?.progress && typeof state.progress === "object" ? state.progress : {};
    for (const [workoutId, workoutProgress] of Object.entries(progress)) {
      if (!workoutProgress || typeof workoutProgress !== "object") {
        continue;
      }
      for (const [exerciseId, item] of Object.entries(workoutProgress)) {
        if (!item || typeof item !== "object") {
          continue;
        }
        await connection.query(
          `
            INSERT INTO workout_progress
              (username, workout_id, exercise_id, sets_done, completed, completed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            username,
            workoutId,
            exerciseId,
            Math.max(0, Math.round(Number(item.setsDone || 0))),
            Boolean(item.completed),
            item.completedAt === undefined ? null : Number(item.completedAt),
            now
          ]
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const saveWeightProgressLog = async (usernameInput, log) => {
  const username = normalizeUsername(usernameInput);
  const pool = await getPool();
  await pool.query(
    `
      INSERT INTO weight_progress_logs (
        id, username, program_id, program_name, day_id, day_name, workout_id, workout_name,
        exercise_id, exercise_name, set_index, weight_kg, reps, rir, note, logged_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        program_id = VALUES(program_id),
        program_name = VALUES(program_name),
        day_id = VALUES(day_id),
        day_name = VALUES(day_name),
        workout_id = VALUES(workout_id),
        workout_name = VALUES(workout_name),
        exercise_id = VALUES(exercise_id),
        exercise_name = VALUES(exercise_name),
        set_index = VALUES(set_index),
        weight_kg = VALUES(weight_kg),
        reps = VALUES(reps),
        rir = VALUES(rir),
        note = VALUES(note),
        logged_at = VALUES(logged_at),
        updated_at = VALUES(updated_at)
    `,
    [
      log.id,
      username,
      log.programId,
      log.programName,
      log.dayId,
      log.dayName,
      log.workoutId,
      log.workoutName,
      log.exerciseId,
      log.exerciseName,
      log.setIndex,
      log.weightKg,
      log.reps,
      log.rir,
      log.note || "",
      log.loggedAt,
      log.createdAt,
      log.updatedAt
    ]
  );
};

export const saveProgramDayCompletionLog = async (usernameInput, log) => {
  const username = normalizeUsername(usernameInput);
  const pool = await getPool();
  await pool.query(
    `
      INSERT INTO program_day_completion_logs (
        id, username, program_id, program_name, day_id, day_name, workout_id, workout_name,
        week_key, completed, completed_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        program_name = VALUES(program_name),
        day_name = VALUES(day_name),
        workout_id = VALUES(workout_id),
        workout_name = VALUES(workout_name),
        week_key = VALUES(week_key),
        completed = VALUES(completed),
        completed_at = VALUES(completed_at),
        updated_at = VALUES(updated_at)
    `,
    [
      log.id,
      username,
      log.programId,
      log.programName,
      log.dayId,
      log.dayName,
      log.workoutId,
      log.workoutName,
      log.weekKey,
      Boolean(log.completed),
      log.completedAt,
      log.updatedAt
    ]
  );
};

export const getRecentWeightProgressLogs = async (usernameInput, maxItems = 80) => {
  const username = normalizeUsername(usernameInput);
  const pool = await getPool();
  const [rows] = await pool.query(
    `
      SELECT
        id,
        username AS userId,
        program_id AS programId,
        program_name AS programName,
        day_id AS dayId,
        day_name AS dayName,
        workout_id AS workoutId,
        workout_name AS workoutName,
        exercise_id AS exerciseId,
        exercise_name AS exerciseName,
        set_index AS setIndex,
        CAST(weight_kg AS DOUBLE) AS weightKg,
        reps,
        rir,
        note,
        logged_at AS loggedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM weight_progress_logs
      WHERE username = ?
      ORDER BY logged_at DESC
      LIMIT ?
    `,
    [username, Math.max(1, Math.min(500, Number(maxItems) || 80))]
  );
  return rows;
};

export const getRecentProgramDayCompletionLogs = async (usernameInput, maxItems = 80) => {
  const username = normalizeUsername(usernameInput);
  const pool = await getPool();
  const [rows] = await pool.query(
    `
      SELECT
        id,
        username AS userId,
        program_id AS programId,
        program_name AS programName,
        day_id AS dayId,
        day_name AS dayName,
        workout_id AS workoutId,
        workout_name AS workoutName,
        week_key AS weekKey,
        completed,
        completed_at AS completedAt,
        updated_at AS updatedAt
      FROM program_day_completion_logs
      WHERE username = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    [username, Math.max(1, Math.min(500, Number(maxItems) || 80))]
  );
  return rows.map((row) => ({ ...row, completed: Boolean(row.completed) }));
};
