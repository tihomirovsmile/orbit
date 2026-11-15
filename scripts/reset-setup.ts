import "dotenv/config";
import "../apps/server/src/runtime.js";
import { readFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import argon2 from "argon2";
import { assertOffline } from "../apps/server/src/database/lock.js";
// Explicit offline recovery tool, no unauthenticated HTTP reset exists.
if (process.argv[2] !== "--confirm-offline-reset")
  throw new Error(
    "Stop the server. Pipe the OWNER password over stdin to npm run db:reset -- --confirm-offline-reset. Existing data is archived, never deleted.",
  );
const dataDir = path.resolve(process.env.DATA_DIR || "storage"),
  dbPath = path.join(dataDir, "orbit.sqlite");
assertOffline(dataDir);
const db = new Database(dbPath, { fileMustExist: true });
const owner = db
  .prepare("SELECT password_hash FROM users WHERE role='OWNER'")
  .get() as any;
const password = readFileSync(0, "utf8").trim();
if (!owner || !(await argon2.verify(owner.password_hash, password)))
  throw new Error("OWNER authentication failed");
db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
const archive = path.join(dataDir, "backups", "pre-reset-" + Date.now());
mkdirSync(archive, { recursive: true });
for (const name of ["orbit.sqlite", "orbit.sqlite-wal", "orbit.sqlite-shm"])
  if (existsSync(path.join(dataDir, name)))
    renameSync(path.join(dataDir, name), path.join(archive, name));
console.log(
  "Database archived. Next start creates a clean installation. Restore from:",
  archive,
);
