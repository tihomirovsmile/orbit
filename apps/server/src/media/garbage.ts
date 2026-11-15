import { unlinkSync } from "node:fs";
import path from "node:path";
import { all, one, run, dataDir, now } from "../database/index.js";
export function removeUnusedOwnedMedia(userId: string) {
  for (const m of all("SELECT * FROM media_assets WHERE owner_id=?", userId)) {
    const used =
      one("SELECT 1 FROM message_media WHERE media_id=? LIMIT 1", m.id) ||
      one(
        "SELECT 1 FROM ticket_media WHERE media_id=? AND ticket_id IN(SELECT id FROM support_tickets WHERE user_id!=?)",
        m.id,
        userId,
      ) ||
      one(
        "SELECT 1 FROM users WHERE id!=? AND avatar=?",
        userId,
        "/media/" + m.id,
      ) ||
      one("SELECT 1 FROM spaces WHERE avatar=?", "/media/" + m.id);
    if (used) {
      run(
        "UPDATE media_assets SET owner_id=NULL,original_name='attachment',attribution=NULL WHERE id=?",
        m.id,
      );
      continue;
    }
    run("DELETE FROM ticket_media WHERE media_id=?", m.id);
    run(
      "INSERT OR IGNORE INTO media_garbage(filename,created_at) VALUES(?,?)",
      m.filename,
      now(),
    );
    run("DELETE FROM media_assets WHERE id=?", m.id);
  }
}
export function collectMediaGarbage() {
  const directory = path.resolve(dataDir, "uploads");
  for (const m of all("SELECT filename FROM media_garbage LIMIT 100")) {
    const file = path.resolve(directory, m.filename);
    if (
      path.dirname(file) !== directory ||
      path.basename(m.filename) !== m.filename
    )
      continue;
    try {
      unlinkSync(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") continue;
    }
    run("DELETE FROM media_garbage WHERE filename=?", m.filename);
  }
}
export function queueUnusedMessageMedia(mediaIds: string[]) {
  for (const mid of new Set(mediaIds)) {
    const m = one("SELECT * FROM media_assets WHERE id=?", mid);
    if (!m || ["CC0", "CC BY", "CC BY-SA"].includes(m.license)) continue;
    if (
      one("SELECT 1 FROM message_media WHERE media_id=?", mid) ||
      one("SELECT 1 FROM ticket_media WHERE media_id=?", mid) ||
      one("SELECT 1 FROM users WHERE avatar=?", "/media/" + mid) ||
      one("SELECT 1 FROM spaces WHERE avatar=?", "/media/" + mid)
    )
      continue;
    run(
      "INSERT OR IGNORE INTO media_garbage(filename,created_at) VALUES(?,?)",
      m.filename,
      now(),
    );
    run("DELETE FROM media_assets WHERE id=?", mid);
  }
}
