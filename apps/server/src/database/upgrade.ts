import type Database from "better-sqlite3";
import { masterUpgrade } from "./master-upgrade.js";
export function upgradeDatabase(db: Database.Database) {
  const add = (table: string, name: string, sql: string) => {
    if (
      !(db.pragma(`table_info(${table})`) as any[]).some((c) => c.name === name)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sql}`);
  };
  db.transaction(() => {
    add("spaces", "avatar", "TEXT");
    add(
      "spaces",
      "allowed_reactions",
      `TEXT NOT NULL DEFAULT '["❤","👍","🔥","😂","🤔","👀"]'`,
    );
    add("space_members", "can_publish", "INTEGER NOT NULL DEFAULT 1");
    add("space_members", "pinned", "INTEGER NOT NULL DEFAULT 0");
    add("space_members", "archived", "INTEGER NOT NULL DEFAULT 0");
    add("providers", "cooldown_until", "INTEGER NOT NULL DEFAULT 0");
    add("providers", "last_error", "TEXT");
    add("ai_jobs", "max_attempts", "INTEGER NOT NULL DEFAULT 5");
    add("ai_jobs", "error_code", "TEXT");
    if (
      !(db.pragma("table_info(spaces)") as any[]).some(
        (c) => c.name === "comments_mode",
      )
    )
      db.exec("UPDATE spaces SET comments_enabled=0 WHERE kind='channel'");
  }).immediate();
  masterUpgrade(db);
}
