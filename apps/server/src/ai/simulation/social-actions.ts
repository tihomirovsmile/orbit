import { autonomyAction } from "./autonomy.js";
import { all, one, run, tx, id, now } from "../../database/index.js";
import {
  activity,
  createSpace,
  member,
  isBlocked,
  HttpError,
  notify,
  emit,
} from "../../core.js";
import { sendMessage } from "../../messages/service.js";
import { capture } from "../memory/index.js";
import { assignAvatar } from "../../media/avatars.js";
import { addComment } from "../../messages/comments.js";
import { readConversation } from "./delivery.js";
import { createTopic } from "../../forum/index.js";
type Generate = (
  agent: any,
  task: string,
  instruction: string,
  spaceId?: string,
) => Promise<string>;
export const socialActions = [
  "self_profile",
  "repost",
  "report",
  "request_deletion",
  "direct",
  "create_channel",
  "create_group",
  "post",
  "subscribe",
  "unsubscribe",
  "comment",
  "avatar",
  "leave",
  "topic",
  "edit",
  "delete",
] as const;
export async function socialAction(
  agent: any,
  job: any,
  action: string,
  generate: Generate,
) {
  if (["self_profile", "repost", "report", "request_deletion"].includes(action))
    return autonomyAction(agent, job, action);
  const payload = JSON.parse(job.payload),
    uid = agent.user_id;
  const spaces = all(
    "SELECT s.* FROM spaces s JOIN space_members sm ON sm.space_id=s.id WHERE sm.user_id=? AND s.frozen=0 AND s.delete_at IS NULL",
    uid,
  );
  if (action === "direct") {
    const target = payload.targetId
      ? one(
          "SELECT * FROM users WHERE id=? AND id!=? AND status='active'",
          payload.targetId,
          uid,
        )
      : one(
          "SELECT u.* FROM users u WHERE u.id!=? AND u.status='active' AND (u.privacy='everyone' OR EXISTS(SELECT 1 FROM follows WHERE follower_id=u.id AND target_id=?)) AND NOT EXISTS(SELECT 1 FROM blocks WHERE (user_id=? AND target_id=u.id) OR (target_id=? AND user_id=u.id)) ORDER BY random() LIMIT 1",
          uid,
          uid,
          uid,
          uid,
        );
    if (!target || isBlocked(uid, target.id)) return;
    const existing = one(
      "SELECT s.id FROM spaces s JOIN space_members a ON a.space_id=s.id JOIN space_members b ON b.space_id=s.id WHERE s.kind='dm' AND a.user_id=? AND b.user_id=?",
      uid,
      target.id,
    );
    const spaceId =
      existing?.id ||
      tx(() =>
        createSpace(uid, {
          kind: "dm",
          title: "Direct conversation",
          members: [target.id],
        }),
      );
    const text = await generate(
      agent,
      "message",
      `Start a brief conversation with ${target.display_name}, grounded only in actual shared memories.`,
      spaceId,
    );
    sendMessage(uid, spaceId, text, { jobId: job.id, depth: 1 });
    capture(uid, spaceId);
    activity(uid, "direct", `Начал разговор с ${target.display_name}`);
    return;
  }
  if (action === "create_channel" || action === "create_group") {
    const interest = JSON.parse(agent.interests)[0];
    const kind = action === "create_channel" ? "channel" : "group";
    if (
      one(
        "SELECT count(*) n FROM spaces WHERE owner_id=? AND kind=?",
        uid,
        kind,
      )!.n >= 3
    )
      return;
    const spaceId = tx(() =>
      createSpace(uid, {
        kind,
        title: `${interest} · ${agent.display_name}`,
        description: `${interest} / ${agent.language}`,
      }),
    );
    activity(uid, action, `Создал ${kind}: ${interest}`);
    return spaceId;
  }
  if (action === "subscribe") {
    const available = payload.spaceId
      ? one(
          "SELECT * FROM spaces WHERE id=? AND visibility='public' AND kind!='dm'",
          payload.spaceId,
        )
      : one(
          "SELECT * FROM spaces WHERE visibility='public' AND kind='channel' AND id NOT IN (SELECT space_id FROM space_members WHERE user_id=?) ORDER BY created_at DESC LIMIT 1",
          uid,
        );
    if (!available) return;
    const joined = run(
      "INSERT OR IGNORE INTO space_members(space_id,user_id,joined_at) VALUES(?,?,?)",
      available.id,
      uid,
      now(),
    );
    if (!joined.changes) return;
    notify(available.owner_id, "subscriber", agent.display_name, available.id);
    activity(uid, "subscribe", `Подписался: ${available.title}`);
    return;
  }
  if (action === "unsubscribe" || action === "leave") {
    const space = spaces.find(
      (s) =>
        s.owner_id !== uid &&
        (action === "unsubscribe"
          ? s.kind === "channel"
          : s.kind === "group") &&
        (!payload.spaceId || s.id === payload.spaceId),
    );
    if (space) {
      run(
        "DELETE FROM space_members WHERE space_id=? AND user_id=?",
        space.id,
        uid,
      );
      activity(uid, action, `Покинул: ${space.title}`);
    }
    return;
  }
  if (action === "post") {
    const channel = spaces.find(
      (s) =>
        s.owner_id === uid &&
        s.kind === "channel" &&
        (!payload.spaceId || payload.spaceId === s.id),
    );
    if (!channel) return;
    const text = await generate(
      agent,
      "message",
      `Write an original post for the stable theme ${channel.title}.`,
      channel.id,
    );
    sendMessage(uid, channel.id, text, { jobId: job.id });
    activity(uid, "post", `Публикация: ${channel.title}`);
    return;
  }
  if (action === "comment") {
    const post = one(
      "SELECT m.*,s.title FROM messages m JOIN spaces s ON s.id=m.space_id JOIN space_members sm ON sm.space_id=s.id AND sm.user_id=? WHERE s.kind='channel' AND s.frozen=0 AND s.delete_at IS NULL AND s.comments_mode!='none' AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1",
      uid,
    );
    if (!post) return;
    readConversation(uid, post.space_id);
    const text = await generate(
      agent,
      "message",
      "Comment on this actual post: " + post.text,
      post.space_id,
    );
    return addComment(uid, post.id, text, job.id);
  }
  if (action === "avatar") {
    if (!agent.customization_enabled && !payload.manual) return;
    if (assignAvatar(uid, job.id)) activity(uid, "avatar", "Обновил аватар");
    return;
  }
  if (action === "topic") {
    const text = await generate(
      agent,
      "message",
      "Write a brief suggestion about this social network. Do not fabricate bugs, bans or violations.",
    );
    const topicId = createTopic(
      uid,
      "ideas",
      `${agent.display_name} · ${JSON.parse(agent.interests)[0]}`,
      text,
    );
    activity(uid, "forum", "Создал тему на форуме");
    return topicId;
  }
  if (action === "edit" || action === "delete") {
    const m = one(
      "SELECT m.* FROM messages m JOIN spaces s ON s.id=m.space_id WHERE sender_id=? AND m.deleted_at IS NULL AND s.frozen=0 ORDER BY m.created_at DESC LIMIT 1",
      uid,
    );
    if (!m) return;
    member(uid, m.space_id, true);
    const text =
      action === "edit"
        ? await generate(
            agent,
            "message",
            "Revise your latest message for clarity while preserving its meaning.",
            m.space_id,
          )
        : m.text;
    tx(() => {
      run(
        "INSERT INTO message_edits VALUES(?,?,?,?)",
        id(),
        m.id,
        m.text,
        now(),
      );
      run(
        "UPDATE messages SET text=?,edited_at=?,deleted_at=? WHERE id=?",
        text,
        now(),
        action === "delete" ? now() : null,
        m.id,
      );
    });
    activity(
      uid,
      action,
      action === "edit" ? "Отредактировал сообщение" : "Удалил своё сообщение",
    );
    emit("messages", { spaceId: m.space_id });
    return;
  }
  throw new HttpError(400, "Неизвестное социальное действие");
}
