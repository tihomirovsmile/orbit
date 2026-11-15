import { all, one, run, tx, id, now, publicUser } from "../database/index.js";
import { member, HttpError, emit, activeUser } from "../core.js";
import { sendMessage } from "./service.js";
export function commentPost(userId: string, postId: string) {
  const p = one(
    "SELECT * FROM messages WHERE id=? AND deleted_at IS NULL",
    postId,
  );
  if (!p) throw new HttpError(404, "Публикация не найдена");
  const s = member(userId, p.space_id);
  if (s.kind !== "channel" || s.frozen || s.delete_at)
    throw new HttpError(423, "Обсуждение недоступно");
  return { p, s };
}
export function getComments(userId: string, postId: string) {
  const { s } = commentPost(userId, postId);
  if (s.comments_mode === "none")
    throw new HttpError(409, "Комментарии отключены владельцем");
  if (s.comments_mode === "group") member(userId, s.discussion_id);
  return all(
    "SELECT * FROM channel_comments WHERE post_id=? AND deleted_at IS NULL ORDER BY created_at LIMIT 500",
    postId,
  ).map((c) => ({
    ...c,
    author: publicUser(
      one("SELECT * FROM users WHERE id=?", c.author_id),
      userId,
    ),
  }));
}
export function addComment(
  userId: string,
  postId: string,
  body: string,
  requestId?: string,
) {
  activeUser(userId);
  const { s } = commentPost(userId, postId);
  if (s.comments_mode === "none")
    throw new HttpError(409, "Комментарии отключены владельцем");
  if (!s.member) throw new HttpError(403, "Сначала подпишитесь на канал");
  const key = requestId || id();
  return tx(() => {
    const old = one(
      "SELECT id FROM channel_comments WHERE id=? AND author_id=? AND post_id=?",
      key,
      userId,
      postId,
    );
    if (old) return old.id;
    let groupMessage = null;
    if (s.comments_mode === "group") {
      member(userId, s.discussion_id, true);
      groupMessage = sendMessage(userId, s.discussion_id, body, {
        jobId: "comment:" + key,
      });
    }
    run(
      "INSERT INTO channel_comments(id,post_id,author_id,body,group_message_id,mode,created_at) VALUES(?,?,?,?,?,?,?)",
      key,
      postId,
      userId,
      body,
      groupMessage,
      s.comments_mode,
      now(),
    );
    emit("messages", { spaceId: s.id });
    return key;
  });
}
