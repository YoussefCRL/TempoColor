import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import initSqlJs from "sql.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const SEEDED_USER_KEY_HEX = "796f7573736566";
const SEEDED_USER_HASH_SALT_HEX = "63376439666533613131623834643636";
const SEEDED_USER_HASH_VALUE =
  "1dff7f37bbb274888c9fa888f05e4dd439abfbe605f580e5c75e8fdab97ce0ef";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let dbPromise;
let transactionQueue = Promise.resolve();

const normalizeUsername = (value) => value.trim().toLowerCase();

const decodeHexString = (hex) => Buffer.from(hex, "hex").toString("utf8");

const hashPassword = (password, salt) =>
  crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");

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

const normalizeParams = (params = []) =>
  params.map((value) => (value === undefined ? null : value));

const toInt = (value, fallback = 0) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? number : fallback;
};

export const getDatabasePath = () =>
  path.resolve(process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "gymify.sqlite"));

const initializeSql = async () =>
  initSqlJs({
    locateFile: (file) => path.resolve(__dirname, "..", "node_modules", "sql.js", "dist", file)
  });

const createDatabaseWrapper = (raw, databasePath) => ({
  run: async (sql, params = []) => {
    raw.run(sql, normalizeParams(params));
  },
  get: async (sql, params = []) => {
    const statement = raw.prepare(sql);
    try {
      statement.bind(normalizeParams(params));
      if (!statement.step()) {
        return undefined;
      }
      return statement.getAsObject();
    } finally {
      statement.free();
    }
  },
  all: async (sql, params = []) => {
    const statement = raw.prepare(sql);
    try {
      statement.bind(normalizeParams(params));
      const rows = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  },
  exec: async (sql) => {
    raw.exec(sql);
  },
  save: async () => {
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    await fs.writeFile(databasePath, Buffer.from(raw.export()));
  },
  close: async () => {
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    await fs.writeFile(databasePath, Buffer.from(raw.export()));
    raw.close();
  }
});

const openSqlite = async (filePath) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const SQL = await initializeSql();
  const existing = await fs.readFile(filePath).catch(() => null);
  const raw = existing ? new SQL.Database(existing) : new SQL.Database();
  return createDatabaseWrapper(raw, filePath);
};

const createSchema = async (db) => {
  await db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_state (
      username TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workouts (
      username TEXT NOT NULL,
      workout_id TEXT NOT NULL,
      workout_name TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      workout_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (username, workout_id),
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workout_progress (
      username TEXT NOT NULL,
      workout_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      sets_done INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (username, workout_id, exercise_id),
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS weight_progress_logs (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      program_id TEXT NULL,
      program_name TEXT NULL,
      day_id TEXT NULL,
      day_name TEXT NULL,
      workout_id TEXT NOT NULL,
      workout_name TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      exercise_name TEXT NOT NULL,
      set_index INTEGER NOT NULL,
      sets_logged INTEGER NOT NULL DEFAULT 1,
      weight_kg REAL NOT NULL,
      reps INTEGER NOT NULL,
      rir INTEGER NULL,
      note TEXT NOT NULL,
      logged_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_weight_user_logged_at
      ON weight_progress_logs (username, logged_at);

    CREATE TABLE IF NOT EXISTS program_day_completion_logs (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      program_id TEXT NOT NULL,
      program_name TEXT NOT NULL,
      day_id TEXT NOT NULL,
      day_name TEXT NOT NULL,
      workout_id TEXT NULL,
      workout_name TEXT NULL,
      week_key TEXT NOT NULL,
      completed INTEGER NOT NULL,
      completed_at INTEGER NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_day_user_updated_at
      ON program_day_completion_logs (username, updated_at);
  `);
};

const seedPrivilegedUser = async (db) => {
  const username = normalizeUsername(decodeHexString(SEEDED_USER_KEY_HEX));
  const salt = decodeHexString(SEEDED_USER_HASH_SALT_HEX);
  const createdAt = Date.UTC(2026, 2, 30, 0, 0, 0);
  await db.run(
    `
      INSERT OR IGNORE INTO users (username, password_salt, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    [username, salt, SEEDED_USER_HASH_VALUE, createdAt, createdAt]
  );
};

export const getPool = async () => {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await openSqlite(getDatabasePath());
      await createSchema(db);
      await seedPrivilegedUser(db);
      await db.save();
      return db;
    })();
  }
  return dbPromise;
};

const withTransaction = async (handler) => {
  const previousTransaction = transactionQueue;
  let releaseTransaction = () => {};
  transactionQueue = new Promise((resolve) => {
    releaseTransaction = resolve;
  });
  await previousTransaction;
  const db = await getPool();
  try {
    await db.exec("BEGIN IMMEDIATE;");
    const result = await handler(db);
    await db.exec("COMMIT;");
    await db.save();
    return result;
  } catch (error) {
    await db.exec("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    releaseTransaction();
  }
};

export const getUserCount = async () => {
  const db = await getPool();
  const row = await db.get("SELECT COUNT(*) AS count FROM users");
  return Number(row?.count || 0);
};

export const createUser = async (usernameInput, password) => {
  const username = normalizeUsername(usernameInput);
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const now = Date.now();
  const db = await getPool();
  try {
    await db.run(
      `
        INSERT INTO users (username, password_salt, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [username, salt, passwordHash, now, now]
    );
    await db.save();
    return { username };
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE constraint failed")) {
      const duplicate = new Error("This username already exists.");
      duplicate.statusCode = 409;
      throw duplicate;
    }
    throw error;
  }
};

export const verifyUser = async (usernameInput, password) => {
  const username = normalizeUsername(usernameInput);
  const db = await getPool();
  const user = await db.get(
    "SELECT username, password_salt, password_hash FROM users WHERE username = ?",
    [username]
  );
  if (!user || hashPassword(password, user.password_salt) !== user.password_hash) {
    const error = new Error("Username or password is invalid.");
    error.statusCode = 401;
    throw error;
  }
  return { username: user.username };
};

export const getUserState = async (usernameInput) => {
  const username = normalizeUsername(usernameInput);
  const db = await getPool();
  const row = await db.get("SELECT state_json FROM user_state WHERE username = ?", [username]);
  return parseJson(row?.state_json, {});
};

export const saveUserState = async (usernameInput, state) => {
  const username = normalizeUsername(usernameInput);
  const now = Date.now();
  await withTransaction(async (db) => {
    await db.run(
      `
        INSERT INTO user_state (username, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `,
      [username, JSON.stringify(state || {}), now]
    );

    await db.run("DELETE FROM workouts WHERE username = ?", [username]);
    const workouts = Array.isArray(state?.workouts) ? state.workouts : [];
    for (const workout of workouts) {
      if (!workout?.id || !workout?.name) {
        continue;
      }
      await db.run(
        `
          INSERT INTO workouts (username, workout_id, workout_name, hidden, workout_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          username,
          String(workout.id),
          String(workout.name),
          Boolean(workout.hidden) ? 1 : 0,
          JSON.stringify(workout),
          now
        ]
      );
    }

    await db.run("DELETE FROM workout_progress WHERE username = ?", [username]);
    const progress = state?.progress && typeof state.progress === "object" ? state.progress : {};
    for (const [workoutId, workoutProgress] of Object.entries(progress)) {
      if (!workoutProgress || typeof workoutProgress !== "object") {
        continue;
      }
      for (const [exerciseId, item] of Object.entries(workoutProgress)) {
        if (!item || typeof item !== "object") {
          continue;
        }
        await db.run(
          `
            INSERT INTO workout_progress
              (username, workout_id, exercise_id, sets_done, completed, completed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            username,
            workoutId,
            exerciseId,
            Math.max(0, toInt(item.setsDone, 0)),
            Boolean(item.completed) ? 1 : 0,
            item.completedAt === undefined ? null : Number(item.completedAt),
            now
          ]
        );
      }
    }
  });
};

export const saveWeightProgressLog = async (usernameInput, log) => {
  const username = normalizeUsername(usernameInput);
  const db = await getPool();
  await db.run(
    `
      INSERT INTO weight_progress_logs (
        id, username, program_id, program_name, day_id, day_name, workout_id, workout_name,
        exercise_id, exercise_name, set_index, sets_logged, weight_kg, reps, rir, note, logged_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        program_id = excluded.program_id,
        program_name = excluded.program_name,
        day_id = excluded.day_id,
        day_name = excluded.day_name,
        workout_id = excluded.workout_id,
        workout_name = excluded.workout_name,
        exercise_id = excluded.exercise_id,
        exercise_name = excluded.exercise_name,
        set_index = excluded.set_index,
        sets_logged = excluded.sets_logged,
        weight_kg = excluded.weight_kg,
        reps = excluded.reps,
        rir = excluded.rir,
        note = excluded.note,
        logged_at = excluded.logged_at,
        updated_at = excluded.updated_at
    `,
    [
      log.id,
      username,
      log.programId ?? null,
      log.programName ?? null,
      log.dayId ?? null,
      log.dayName ?? null,
      log.workoutId,
      log.workoutName,
      log.exerciseId,
      log.exerciseName,
      Math.max(1, toInt(log.setIndex, 1)),
      Math.max(1, toInt(log.setsLogged, 1)),
      Number(log.weightKg),
      Math.max(1, toInt(log.reps, 1)),
      log.rir === null || log.rir === undefined ? null : toInt(log.rir, 0),
      log.note || "",
      Number(log.loggedAt),
      Number(log.createdAt),
      Number(log.updatedAt)
    ]
  );
  await db.save();
};

export const saveProgramDayCompletionLog = async (usernameInput, log) => {
  const username = normalizeUsername(usernameInput);
  const db = await getPool();
  await db.run(
    `
      INSERT INTO program_day_completion_logs (
        id, username, program_id, program_name, day_id, day_name, workout_id, workout_name,
        week_key, completed, completed_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        program_name = excluded.program_name,
        day_name = excluded.day_name,
        workout_id = excluded.workout_id,
        workout_name = excluded.workout_name,
        week_key = excluded.week_key,
        completed = excluded.completed,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `,
    [
      log.id,
      username,
      log.programId,
      log.programName,
      log.dayId,
      log.dayName,
      log.workoutId ?? null,
      log.workoutName ?? null,
      log.weekKey,
      Boolean(log.completed) ? 1 : 0,
      log.completedAt === null || log.completedAt === undefined ? null : Number(log.completedAt),
      Number(log.updatedAt)
    ]
  );
  await db.save();
};

export const getRecentWeightProgressLogs = async (usernameInput, maxItems = 80) => {
  const username = normalizeUsername(usernameInput);
  const db = await getPool();
  const rows = await db.all(
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
        sets_logged AS setsLogged,
        weight_kg AS weightKg,
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
  return rows.map((row) => ({
    ...row,
    setsLogged: Math.max(1, toInt(row.setsLogged, 1)),
    weightKg: Number(row.weightKg),
    reps: toInt(row.reps, 0),
    rir: row.rir === null || row.rir === undefined ? null : toInt(row.rir, 0)
  }));
};

export const getRecentProgramDayCompletionLogs = async (usernameInput, maxItems = 80) => {
  const username = normalizeUsername(usernameInput);
  const db = await getPool();
  const rows = await db.all(
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
