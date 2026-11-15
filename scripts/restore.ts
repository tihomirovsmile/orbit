import "dotenv/config";
import "../apps/server/src/runtime.js";
import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { assertOffline } from "../apps/server/src/database/lock.js";
const source = process.argv[2];
if (!source || process.argv[3] !== "--confirm-offline")
  throw new Error(
    "Stop Orbit first. Usage: npm run db:restore -- <backup.sqlite> --confirm-offline",
  );
const root = path.resolve(process.env.DATA_DIR || "storage"),
  target = path.join(root, "orbit.sqlite");
assertOffline(root);
if (path.resolve(source) === target)
  throw new Error("Source and target must differ");
const probe = new Database(path.resolve(source), {
  readonly: true,
  fileMustExist: true,
});
if (
  probe.pragma("integrity_check", { simple: true }) !== "ok" ||
  (probe.pragma("foreign_key_check") as unknown[]).length
)
  throw new Error("Backup failed integrity or foreign-key validation");
if (![1,2,3].includes(Number(probe.pragma("user_version", { simple: true }))))
  throw new Error("Unsupported schema version");
probe.close();
mkdirSync(root, { recursive: true });
const safety = target + ".before-restore-" + Date.now();
// An exclusive SQLite lock prevents a restore while another process has a transaction open.
if (existsSync(target)) {
  const current = new Database(target);
  current.pragma("busy_timeout=1000");
  current.exec("BEGIN EXCLUSIVE");
  current.exec("ROLLBACK");
  current.close();
  copyFileSync(target, safety);
}
const staged = target + ".restore-tmp";
copyFileSync(path.resolve(source), staged);
for (const suffix of ["-wal", "-shm"])
  if (existsSync(target + suffix)) unlinkSync(target + suffix);
renameSync(staged, target);
console.log(
  "Database restored. Preserve the matching encryption key and uploads before restarting. Previous database copy:",
  safety,
);
