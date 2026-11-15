import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  type: text("type").notNull(),
  role: text("role").notNull(),
  language: text("language").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeen: integer("last_seen").notNull(),
});
