import { all, one, run, id, now, tx, publicUser } from "../database/index.js";
import {
  notifyIdentity,
  NOTIFY_SPACE_ID,
} from "../../../../packages/shared/policy.js";
type Publisher = (userId: string, event: string, data: any) => void;
let publish: Publisher = () => {};
export function setNotifyPublisher(value: Publisher) {
  publish = value;
}
export function ensureNotify(userId: string) {
  if (!one("SELECT id FROM users WHERE id=?", userId)) return;
  tx(() => {
    run(
      "INSERT OR IGNORE INTO notify_inboxes(user_id,created_at) VALUES(?,?)",
      userId,
      now(),
    );
    deliverNotify(userId, {
      key: "welcome",
      kind: "welcome",
      title: "Добро пожаловать в Notify",
      body: "Здесь появляются важные сообщения Orbit. Поддержка никогда не просит пароль, код подтверждения или секрет восстановления.",
      importance: "normal",
    });
  });
}
export function initializeNotify() {
  for (const u of all("SELECT id FROM users")) ensureNotify(u.id);
}
export type SystemEvent = {
  key: string;
  kind: string;
  title: string;
  body: string;
  importance?: "normal" | "high" | "critical";
  objectType?: string;
  objectId?: string;
  decisionId?: string;
  ticketId?: string;
  payload?: Record<string, unknown>;
};
export function deliverNotify(userId: string, event: SystemEvent) {
  if (!one("SELECT id FROM users WHERE id=?", userId)) return null;
  const eventId = id();
  run(
    "INSERT OR IGNORE INTO notify_inboxes(user_id,created_at) VALUES(?,?)",
    userId,
    now(),
  );
  const added = run(
    "INSERT OR IGNORE INTO notify_events(id,user_id,event_key,kind,title,body,importance,object_type,object_id,decision_id,ticket_id,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    eventId,
    userId,
    event.key,
    event.kind,
    event.title,
    event.body,
    event.importance || "normal",
    event.objectType || null,
    event.objectId || null,
    event.decisionId || null,
    event.ticketId || null,
    JSON.stringify(event.payload || {}),
    now(),
  );
  if (!added.changes)
    return one(
      "SELECT id FROM notify_events WHERE user_id=? AND event_key=?",
      userId,
      event.key,
    )?.id;
  if (event.importance === "critical" || event.importance === "high")
    run("UPDATE notify_inboxes SET hidden=0 WHERE user_id=?", userId);
  publish(userId, "notify-event", {
    id: eventId,
    importance: event.importance || "normal",
  });
  publish(userId, "refresh", {});
  return eventId;
}
export function notifySpace(userId: string) {
  ensureNotify(userId);
  const inbox = one("SELECT * FROM notify_inboxes WHERE user_id=?", userId);
  const user = one("SELECT status FROM users WHERE id=?", userId);
  if (inbox?.hidden && !["banned", "deletion_pending"].includes(user?.status))
    return null;
  const last = one(
    "SELECT title,body,created_at FROM notify_events WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
    userId,
  );
  return {
    id: NOTIFY_SPACE_ID,
    kind: "system",
    title: "Notify",
    description: notifyIdentity.bio,
    slug: "notify",
    visibility: "private",
    system: true,
    otherUser: notifyIdentity,
    avatar: notifyIdentity.avatar,
    members: 1,
    joined: 1,
    verified: 0,
    canManage: false,
    isOwner: false,
    lastText: last?.title || "",
    lastAt: last?.created_at || inbox.created_at,
    unread: one(
      "SELECT count(*) n FROM notify_events WHERE user_id=? AND read_at IS NULL",
      userId,
    )!.n,
    membership: { role: "member", pinned: 1, muted: inbox.muted, archived: 0 },
    frozen: 0,
  };
}
export function ownDecisions(userId: string) {
  return all(
    `SELECT d.id,d.target_type targetType,d.target_id targetId,d.action,d.reason_code reasonCode,d.public_reason publicReason,d.reason,d.active,d.starts_at startsAt,d.expires_at expiresAt,d.ended_at endedAt,d.end_reason endReason FROM moderation_decisions d WHERE (d.target_type='user' AND d.target_id=?) OR (d.target_type='space' AND d.target_id IN(SELECT id FROM spaces WHERE owner_id=?)) ORDER BY d.starts_at DESC`,
    userId,
    userId,
  );
}
export function restrictedAccount(userId: string) {
  const user = one("SELECT * FROM users WHERE id=?", userId);
  return {
    user: publicUser(user, userId),
    decisions: ownDecisions(userId),
    notify: notifySpace(userId),
    serverNow: now(),
    deletionAt: user?.deletion_at || null,
  };
}
