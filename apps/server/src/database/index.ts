import { calculateAge } from "../../../../packages/shared/policy.js";
import Database from "better-sqlite3";
import "../runtime.js";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { upgradeDatabase } from "./upgrade.js";
export const id = () => randomUUID();
export const now = () => Date.now();
export const dataDir = path.resolve(process.env.DATA_DIR || "storage");
mkdirSync(dataDir, { recursive: true });
for (const dir of ["uploads", "avatars", "backups"])
  mkdirSync(path.join(dataDir, dir), { recursive: true });
export const sqlite = new Database(path.join(dataDir, "orbit.sqlite"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
sqlite.exec(readFileSync(new URL("001_initial.sql", import.meta.url), "utf8"));
upgradeDatabase(sqlite);
export const orm = drizzle(sqlite);
export const all = <T = any>(sql: string, ...args: any[]): T[] =>
  sqlite.prepare(sql).all(...args) as T[];
export const one = <T = any>(sql: string, ...args: any[]): T | undefined =>
  sqlite.prepare(sql).get(...args) as T | undefined;
export const run = (sql: string, ...args: any[]) =>
  sqlite.prepare(sql).run(...args);
export const tx = <T>(fn: () => T): T => sqlite.transaction(fn).immediate();
export function setting<T = any>(key: string, fallback: T): T {
  const row = one("SELECT value FROM system_settings WHERE key=?", key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(key: string, value: unknown) {
  run(
    "INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    key,
    JSON.stringify(value),
  );
}
export function audit(
  actor: string | null,
  action: string,
  target: string | null,
  detail: unknown = {},
) {
  run(
    "INSERT INTO audit_logs VALUES(?,?,?,?,?,?)",
    id(),
    actor,
    action,
    target,
    JSON.stringify(detail),
    now(),
  );
}
export function publicUser(u: any, viewerId?: string) {
  if (!u) return null;
  const unavailable = ["banned", "deletion_pending"].includes(u.status);
  const canSeePresence =
    u.id === viewerId ||
    u.presence_visibility === "everyone" ||
    !u.presence_visibility ||
    (u.presence_visibility === "contacts" &&
      viewerId &&
      !!one(
        "SELECT 1 FROM follows a JOIN follows b ON a.follower_id=b.target_id AND a.target_id=b.follower_id WHERE a.follower_id=? AND a.target_id=?",
        u.id,
        viewerId,
      ));
  const online = !unavailable && canSeePresence && u.presence_until > now();
  return {
    id: u.id,
    username: u.username,
    displayName: unavailable ? "DELETED" : u.display_name,
    bio: unavailable ? "" : u.bio,
    avatar: unavailable ? null : u.avatar,
    permissions:
      u.id === viewerId ? JSON.parse(u.permissions || "{}") : undefined,
    age: unavailable ? null : calculateAge(u.birth_date || ""),
    type: u.type,
    role: u.role,
    language: u.language,
    country: unavailable ? "" : u.country,
    status: u.status,
    lastSeen: !unavailable && canSeePresence ? u.last_seen : 0,
    createdAt: u.created_at,
    verified: unavailable ? 0 : u.derived_verified || 0,
    verification: {
      type: "derived",
      active: !unavailable && !!u.derived_verified,
    },
    frozen: u.status === "banned",
    deleting: u.status === "deletion_pending",
    deletionAt: u.deletion_at || null,
    birthDate: unavailable ? null : u.birth_date || null,
    presence: {
      online: !!online,
      lastSeen: !unavailable && canSeePresence ? u.last_seen : 0,
      visible: !!canSeePresence,
    },
    presenceVisibility: u.id === viewerId ? u.presence_visibility : undefined,
    automated: u.type === "ai",
    state: u.state,
    privacy: u.privacy,
  };
}
