import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createUser,
  getDatabasePath,
  getPool,
  getRecentProgramDayCompletionLogs,
  getRecentWeightProgressLogs,
  getUserCount,
  getUserState,
  saveProgramDayCompletionLog,
  saveUserState,
  saveWeightProgressLog,
  verifyUser
} from "./db.mjs";

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;
const app = express();
const port = Number(process.env.PORT || process.env.API_PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "..", "dist");
const passenger = globalThis.PhusionPassenger;
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || "https://youssefcrl.github.io,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

if (passenger?.configure) {
  passenger.configure({ autoInstall: false });
}

const normalizeUsername = (value) => String(value || "").trim().toLowerCase();

const validateUsername = (username) => {
  if (!USERNAME_PATTERN.test(String(username || "").trim())) {
    const error = new Error("Use 3-32 chars: letters, numbers, dot, underscore, or dash.");
    error.statusCode = 400;
    throw error;
  }
};

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] || "Content-Type"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: "25mb" }));

app.get(
  "/api/health",
  asyncHandler(async (_req, res) => {
    await getPool();
    res.json({ ok: true, database: "sqlite", path: getDatabasePath() });
  })
);

app.get(
  "/api/auth/summary",
  asyncHandler(async (_req, res) => {
    res.json({ userCount: await getUserCount() });
  })
);

app.post(
  "/api/auth/register",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    validateUsername(username);
    if (typeof password !== "string" || password.length < 6) {
      const error = new Error("Password must be at least 6 characters.");
      error.statusCode = 400;
      throw error;
    }
    res.status(201).json({ user: await createUser(username, password) });
  })
);

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    validateUsername(username);
    if (typeof password !== "string" || password.length < 6) {
      const error = new Error("Username or password is invalid.");
      error.statusCode = 401;
      throw error;
    }
    res.json({ user: await verifyUser(username, password) });
  })
);

app.get(
  "/api/users/:username/state",
  asyncHandler(async (req, res) => {
    validateUsername(req.params.username);
    res.json({ data: await getUserState(req.params.username) });
  })
);

app.put(
  "/api/users/:username/state",
  asyncHandler(async (req, res) => {
    validateUsername(req.params.username);
    await saveUserState(req.params.username, req.body?.data || {});
    res.json({ ok: true });
  })
);

app.get(
  "/api/users/:username/weight-progress",
  asyncHandler(async (req, res) => {
    validateUsername(req.params.username);
    res.json({
      logs: await getRecentWeightProgressLogs(req.params.username, req.query.limit)
    });
  })
);

app.post(
  "/api/users/:username/weight-progress",
  asyncHandler(async (req, res) => {
    validateUsername(req.params.username);
    await saveWeightProgressLog(req.params.username, req.body?.log);
    res.status(201).json({ ok: true });
  })
);

app.get(
  "/api/users/:username/day-completions",
  asyncHandler(async (req, res) => {
    validateUsername(req.params.username);
    res.json({
      logs: await getRecentProgramDayCompletionLogs(req.params.username, req.query.limit)
    });
  })
);

app.post(
  "/api/users/:username/day-completions",
  asyncHandler(async (req, res) => {
    validateUsername(req.params.username);
    await saveProgramDayCompletionLog(req.params.username, req.body?.log);
    res.status(201).json({ ok: true });
  })
);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use(express.static(distPath));
app.get(/.*/, (_req, res) => {
  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    res.json({ ok: true, service: "TempoColor API" });
    return;
  }
  res.sendFile(path.join(distPath, "index.html"));
});

app.use((error, _req, res, _next) => {
  const status = Number(error.statusCode || 500);
  res.status(status).json({
    error: status >= 500 ? "Server error." : error.message
  });
  if (status >= 500) {
    console.error(error);
  }
});

const listenTarget = passenger ? "passenger" : port;

app.listen(listenTarget, () => {
  console.log(
    passenger
      ? "TempoColor API listening through Passenger"
      : `TempoColor API listening on http://localhost:${port}`
  );
});
