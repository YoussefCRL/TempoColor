import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "ssh2";
import dotenv from "dotenv";

dotenv.config({ path: ".env.production.local" });
dotenv.config({ path: ".env.local" });
dotenv.config();

const rootDir = process.cwd();
const remotePath = process.env.PROD_REMOTE_PATH || "/var/www/vhosts/recursing-blackwell.141-95-154-60.plesk.page/httpdocs";
const apiBaseUrl =
  process.env.PROD_API_BASE_URL || "https://recursing-blackwell.141-95-154-60.plesk.page/api";
const minimumDeployVersion = "1.0.1";

const required = [
  "PROD_SSH_HOST",
  "PROD_SSH_USER",
  "PROD_SSH_PASSWORD",
  "MYSQL_URL",
  "MYSQL_DATABASE",
  "MYSQL_SSL_CA_CERT"
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required production env values: ${missing.join(", ")}`);
}

const runLocal = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        ...(options.env || {})
      }
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
      }
    });
  });

const parseVersion = (value) => {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return [0, 0, 0];
  }
  return match.slice(1).map((part) => Number(part));
};

const compareVersions = (left, right) => {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
};

const incrementPatchVersion = (value) => {
  const [major, minor, patch] = parseVersion(value);
  return `${major}.${minor}.${patch + 1}`;
};

const writeJsonFile = async (filePath, value) => {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const updatePackageLockVersion = async (nextVersion) => {
  const lockPath = path.join(rootDir, "package-lock.json");
  const raw = await fs.readFile(lockPath, "utf8").catch(() => "");
  if (!raw) {
    return;
  }
  const lock = JSON.parse(raw);
  if (lock.version) {
    lock.version = nextVersion;
  }
  if (lock.packages?.[""]) {
    lock.packages[""].version = nextVersion;
  }
  await writeJsonFile(lockPath, lock);
};

const bumpDeployVersion = async () => {
  const packagePath = path.join(rootDir, "package.json");
  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
  const currentVersion = pkg.version || "0.0.0";
  const nextVersion =
    compareVersions(currentVersion, minimumDeployVersion) < 0
      ? minimumDeployVersion
      : incrementPatchVersion(currentVersion);

  pkg.version = nextVersion;
  await writeJsonFile(packagePath, pkg);
  await updatePackageLockVersion(nextVersion);
  await fs.writeFile(
    path.join(rootDir, "src", "appVersion.ts"),
    `export const APP_VERSION = "${nextVersion}";\n`
  );
  return nextVersion;
};

const connectSsh = () =>
  new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on("ready", () => resolve(client))
      .on("error", reject)
      .connect({
        host: process.env.PROD_SSH_HOST,
        port: Number(process.env.PROD_SSH_PORT || 22),
        username: process.env.PROD_SSH_USER,
        password: process.env.PROD_SSH_PASSWORD,
        readyTimeout: 30000
      });
  });

const execRemote = (client, command) =>
  new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      let stderr = "";
      stream
        .on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Remote command failed (${code}): ${command}\n${stderr}`));
          }
        })
        .on("data", (data) => process.stdout.write(data));
      stream.stderr.on("data", (data) => {
        stderr += data.toString();
        process.stderr.write(data);
      });
    });
  });

const getSftp = (client) =>
  new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error);
      } else {
        resolve(sftp);
      }
    });
  });

const sftpMkdir = (sftp, target) =>
  new Promise((resolve, reject) => {
    sftp.mkdir(target, (error) => {
      if (!error || error.code === 4) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

const ensureRemoteDir = async (sftp, target) => {
  const normalized = target.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  let current = normalized.startsWith("/") ? "" : ".";
  for (const part of parts) {
    current = current === "" ? `/${part}` : `${current}/${part}`;
    await sftpMkdir(sftp, current);
  }
};

const uploadFile = async (sftp, localFile, remoteFile) => {
  await ensureRemoteDir(sftp, path.posix.dirname(remoteFile));
  await new Promise((resolve, reject) => {
    sftp.fastPut(localFile, remoteFile, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

const uploadDirectory = async (sftp, localDir, remoteDir) => {
  await ensureRemoteDir(sftp, remoteDir);
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const localEntry = path.join(localDir, entry.name);
    const remoteEntry = `${remoteDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await uploadDirectory(sftp, localEntry, remoteEntry);
    } else if (entry.isFile()) {
      await uploadFile(sftp, localEntry, remoteEntry);
    }
  }
};

const makeProductionEnv = () =>
  [
    `NODE_ENV=production`,
    `API_PORT=${process.env.API_PORT || 3001}`,
    `CORS_ALLOWED_ORIGINS=${process.env.CORS_ALLOWED_ORIGINS || "https://youssefcrl.github.io,http://localhost:5173"}`,
    `MYSQL_URL=${process.env.MYSQL_URL}`,
    `MYSQL_DATABASE=${process.env.MYSQL_DATABASE}`,
    `MYSQL_SSL_CA_CERT=${JSON.stringify(process.env.MYSQL_SSL_CA_CERT).slice(1, -1)}`
  ].join("\n") + "\n";

const main = async () => {
  const deployVersion = await bumpDeployVersion();
  console.log(`Deploy version: ${deployVersion}`);
  console.log("Typechecking and building frontend...");
  await runLocal("npx", ["tsc", "--noEmit"]);
  await runLocal("npm", ["run", "build"], {
    env: {
      VITE_API_BASE_URL: apiBaseUrl
    }
  });

  console.log("Connecting to production server...");
  const client = await connectSsh();
  try {
    const sftp = await getSftp(client);
    await ensureRemoteDir(sftp, remotePath);

    console.log(`Uploading backend to ${remotePath}...`);
    await uploadFile(sftp, path.join(rootDir, "app.js"), `${remotePath}/app.js`);
    await uploadFile(sftp, path.join(rootDir, "index.js"), `${remotePath}/index.js`);
    await uploadFile(sftp, path.join(rootDir, "server.js"), `${remotePath}/server.js`);
    await uploadFile(sftp, path.join(rootDir, "package.json"), `${remotePath}/package.json`);
    await uploadFile(sftp, path.join(rootDir, "package-lock.json"), `${remotePath}/package-lock.json`);
    await uploadDirectory(sftp, path.join(rootDir, "server"), `${remotePath}/server`);
    await uploadFile(
      sftp,
      path.join(rootDir, "scripts", "setup-mysql.mjs"),
      `${remotePath}/scripts/setup-mysql.mjs`
    );

    const tempEnvPath = path.join(rootDir, ".deploy-prod.env.tmp");
    await fs.writeFile(tempEnvPath, makeProductionEnv(), { encoding: "utf8", mode: 0o600 });
    try {
      await uploadFile(sftp, tempEnvPath, `${remotePath}/.env`);
    } finally {
      await fs.rm(tempEnvPath, { force: true });
    }

    console.log("Installing production dependencies and preparing MySQL schema...");
    await execRemote(
      client,
      `cd ${quoteShell(remotePath)} && /opt/plesk/node/20/bin/npm ci --omit=dev && /opt/plesk/node/20/bin/node scripts/setup-mysql.mjs`
    );

    console.log("Restarting this Plesk Node app...");
    await execRemote(
      client,
      `cd ${quoteShell(remotePath)} && mkdir -p tmp && touch tmp/restart.txt`
    );
  } finally {
    client.end();
  }

  console.log("Publishing frontend to GitHub Pages...");
  await runLocal("npm", ["run", "deploy:pages"], {
    env: {
      VITE_API_BASE_URL: apiBaseUrl
    }
  });

  console.log(`Production deploy complete. API: ${apiBaseUrl}`);
};

const quoteShell = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
