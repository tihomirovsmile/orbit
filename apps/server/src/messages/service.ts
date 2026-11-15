import {
  all,
  one,
  run,
  tx,
  id,
  now,
  setting,
  publicUser,
} from "../database/index.js";
import {
  member,
  activeUser,
  isBlocked,
  HttpError,
  notify,
  emit,
  activity,
} from "../core.js";
import { validateAttachments } from "../media/limits.js";
export function queueReply(
  agentId: string,
  spaceId: string,
  sourceId: string,
  depth = 0,
) {
  if (
    depth >= 4 ||
    one(
      "SELECT 1 FROM ai_deliveries WHERE agent_id=? AND space_id=? AND status IN ('pending','held')",
      agentId,
      spaceId,
    )
  )
    return;
  const exists = one(
    "SELECT id FROM ai_jobs WHERE agent_id=? AND kind='reply' AND status IN ('queued','running') AND json_extract(payload,'$.spaceId')=?",
    agentId,
    spaceId,
  );
  if (exists) return;
  const persona = one(
    "SELECT traits,schedule FROM ai_personas WHERE user_id=?",
    agentId,
  );
  const traits = persona ? JSON.parse(persona.traits) : { sociability: 0.5 };
  const simulation = setting("simulation", { mode: "live", speed: 1 });
  let delay =
    simulation.mode === "test"
      ? 1500 + Math.random() * 7000
      : ((4000 + Math.random() * 65000) * (1.2 - traits.sociability * 0.7)) /
        (simulation.speed || 1);
  if (persona && simulation.mode !== "test" && simulation.speed === 1) {
    const schedule = JSON.parse(persona.schedule);
    const hour = schedule.timezone
      ? Number(
          new Intl.DateTimeFormat("en", {
            timeZone: schedule.timezone,
            hour: "2-digit",
            hourCycle: "h23",
          }).format(now()),
        )
      : (new Date().getUTCHours() + schedule.offset + 24) % 24;
    const sleep = schedule.sleep % 24;
    const awake =
      sleep > schedule.wake
        ? hour >= schedule.wake && hour < sleep
        : hour >= schedule.wake || hour < sleep;
    if (!awake) delay += ((schedule.wake - hour + 24) % 24) * 3600000;
  }
  run(
    "INSERT INTO ai_jobs(id,agent_id,kind,payload,priority,run_at,created_at) VALUES(?,?,?,?,?,?,?)",
    id(),
    agentId,
    "reply",
    JSON.stringify({ spaceId, sourceId, depth }),
    10,
    now() + delay,
    now(),
  );
}
export function sendMessage(
  userId: string,
  spaceId: string,
  text: string,
  options: {
    replyTo?: string | null;
    forwardedFrom?: string | null;
    mediaIds?: string[];
    jobId?: string;
    depth?: number;
  } = {},
) {
  const u = activeUser(userId);
  const space = member(userId, spaceId, true);
  if (space.kind === "dm") {
    const peer = one(
      "SELECT user_id FROM space_members WHERE space_id=? AND user_id!=?",
      spaceId,
      userId,
    );
    if (
      peer &&
      ["banned", "deletion_pending"].includes(
        one("SELECT status FROM users WHERE id=?", peer.user_id)?.status,
      )
    )
      throw new HttpError(423, "Аккаунт собеседника недоступен для переписки");
    if (peer && isBlocked(userId, peer.user_id))
      throw new HttpError(403, "Общение заблокировано");
  }
  if (options.jobId) {
    const existing = one(
      "SELECT id FROM messages WHERE job_id=?",
      options.jobId,
    );
    if (existing) return existing.id;
  }
  if (options.replyTo) {
    const parent = one(
      "SELECT * FROM messages WHERE id=? AND space_id=? AND deleted_at IS NULL",
      options.replyTo,
      spaceId,
    );
    if (!parent) throw new HttpError(400, "Сообщение для ответа не найдено");
  }
  const original = options.forwardedFrom
    ? one(
        "SELECT * FROM messages WHERE id=? AND deleted_at IS NULL",
        options.forwardedFrom,
      )
    : null;
  if (options.forwardedFrom) {
    if (!original) throw new HttpError(404, "Оригинал не найден");
    member(userId, original.space_id);
    text = original.text;
  }
  const mediaIds = original
    ? all(
        "SELECT media_id FROM message_media WHERE message_id=?",
        original.id,
      ).map((m) => m.media_id)
    : options.mediaIds || [];
  validateAttachments(mediaIds);
  for (const media of mediaIds)
    if (
      !original &&
      !one(
        "SELECT id FROM media_assets WHERE id=? AND owner_id=?",
        media,
        userId,
      )
    )
      throw new HttpError(403, "Нет доступа к файлу");
  const messageId = id();
  tx(() => {
    run("UPDATE users SET last_seen=? WHERE id=?", now(), userId);
    if (u.type === "ai")
      run(
        "UPDATE ai_personas SET state=? WHERE user_id=?",
        space.kind === "channel" ? "POSTING" : "CHATTING",
        userId,
      );
    run(
      "INSERT INTO messages(id,space_id,sender_id,text,reply_to,forwarded_from,created_at,job_id) VALUES(?,?,?,?,?,?,?,?)",
      messageId,
      spaceId,
      userId,
      text,
      options.replyTo || null,
      options.forwardedFrom || null,
      now(),
      options.jobId || null,
    );
    for (const media of mediaIds)
      run("INSERT INTO message_media VALUES(?,?)", messageId, media);
    for (const m of all(
      "SELECT user_id FROM space_members WHERE space_id=? AND user_id!=?",
      spaceId,
      userId,
    )) {
      notify(
        m.user_id,
        "message",
        `${space.kind === "channel" ? space.title : u.display_name}: ${text.slice(0, 100)}`,
        spaceId,
      );
    }
  });
  for (const m of all(
    "SELECT u.id,u.type FROM space_members sm JOIN users u ON u.id=sm.user_id WHERE sm.space_id=? AND u.id!=? AND u.status='active'",
    spaceId,
    userId,
  )) {
    if (
      m.type === "ai" &&
      space.kind !== "channel" &&
      (u.type === "human" || Math.random() < 0.45)
    )
      queueReply(m.id, spaceId, messageId, options.depth || 0);
  }
  emit("messages", { spaceId });
  return messageId;
}
export function getMessages(
  userId: string,
  spaceId: string,
  query = "",
  before = Number.MAX_SAFE_INTEGER,
) {
  const space = member(userId, spaceId);
  if (space.frozen || space.delete_at)
    throw new HttpError(
      423,
      space.delete_at ? "Сообщество ожидает удаления" : "Сообщество заморожено",
      "SPACE_UNAVAILABLE",
    );
  return all(
    "SELECT m.*,u.display_name,u.type,u.avatar,u.derived_verified,u.status FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.space_id=? AND m.created_at<? AND m.deleted_at IS NULL AND m.text LIKE ? ORDER BY m.created_at DESC LIMIT 100",
    spaceId,
    before,
    `%${query}%`,
  )
    .reverse()
    .map((m) => ({
      id: m.id,
      spaceId: m.space_id,
      senderId: space.kind === "channel" ? space.id : m.sender_id,
      text: m.text,
      createdAt: m.created_at,
      editedAt: m.edited_at,
      deletedAt: m.deleted_at,
      replyTo: m.reply_to,
      forwardedFrom: m.forwarded_from,
      pinned: m.pinned,
      displayName:
        space.kind === "channel"
          ? space.title
          : ["banned", "deletion_pending"].includes(m.status)
            ? "DELETED"
            : m.display_name,
      type: space.kind === "channel" ? "channel" : m.type,
      avatar:
        space.kind === "channel"
          ? space.avatar
          : ["banned", "deletion_pending"].includes(m.status)
            ? null
            : m.avatar,
      verified:
        space.kind === "channel"
          ? space.verified
          : m.status === "active"
            ? m.derived_verified
            : 0,
      signature:
        space.kind === "channel" && space.show_author
          ? publicUser(
              one("SELECT * FROM users WHERE id=?", m.sender_id),
              userId,
            )?.displayName
          : null,
      commentsCount: one(
        "SELECT count(*) n FROM channel_comments WHERE post_id=? AND deleted_at IS NULL",
        m.id,
      )!.n,
      canEdit: m.sender_id === userId || space.member?.role === "admin",
      attachments: all(
        "SELECT a.id,a.original_name name,a.mime,a.size FROM media_assets a JOIN message_media mm ON mm.media_id=a.id WHERE mm.message_id=?",
        m.id,
      ),
      reactions: all(
        "SELECT emoji,count(*) count,max(user_id=?) mine FROM reactions WHERE message_id=? GROUP BY emoji",
        userId,
        m.id,
      ),
      readCount: one(
        "SELECT count(*) n FROM message_reads WHERE message_id=? AND user_id!=?",
        m.id,
        m.sender_id,
      )!.n,
    }));
}
export function rememberInteraction(
  agentId: string,
  targetId: string,
  content: string,
  sourceId: string,
) {
  tx(() => {
    if (
      one(
        "SELECT id FROM agent_memories WHERE user_id=? AND source_id=?",
        agentId,
        sourceId,
      )
    )
      return;
    run(
      "INSERT INTO agent_memories VALUES(?,?,?,?,?,?,?,?)",
      id(),
      agentId,
      targetId,
      /promise|обеща|обіця|prometto|prometo/i.test(content)
        ? "promise"
        : "episodic",
      content,
      /promise|обеща|обіця|prometto|prometo/i.test(content) ? 0.95 : 0.6,
      sourceId,
      now(),
    );
    run(
      "INSERT INTO relationships(user_id,target_id,interactions,updated_at) VALUES(?,?,1,?) ON CONFLICT(user_id,target_id) DO UPDATE SET interactions=interactions+1,strength=min(1,strength+0.01),kind=CASE WHEN interactions>100 THEN 'friend' WHEN interactions>20 THEN 'frequent' ELSE 'acquaintance' END,updated_at=excluded.updated_at",
      agentId,
      targetId,
      now(),
    );
  });
}
