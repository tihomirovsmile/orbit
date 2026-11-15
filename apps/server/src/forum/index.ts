import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { all, one, run, tx, id, now, audit } from "../database/index.js";
import { requireUser, requireAdmin, HttpError, notify, emit } from "../core.js";
export const categories = [
  "general",
  "ideas",
  "bugs",
  "administration",
  "reports",
  "appeals",
  "support",
  "announcements",
];
export function createTopic(
  userId: string,
  category: string,
  title: string,
  body: string,
) {
  const topicId = id();
  run(
    "INSERT INTO forum_topics VALUES(?,?,?,?,?,'open',0,?,?)",
    topicId,
    userId,
    category,
    title,
    body,
    now(),
    now(),
  );
  return topicId;
}
export function createAppeal(userId: string, body: string) {
  const action = one(
    "SELECT * FROM moderation_actions WHERE target_id=? AND action='ban' ORDER BY created_at DESC LIMIT 1",
    userId,
  );
  if (!action) throw new HttpError(400, "Блокировка не найдена");
  const existing = one(
    "SELECT topic_id id FROM ban_appeals WHERE action_id=? AND status='open'",
    action.id,
  );
  if (existing) return existing.id;
  return tx(() => {
    const topicId = createTopic(
      userId,
      "appeals",
      "Обжалование блокировки",
      `${body}\n\nПричина блокировки: ${action.reason}`,
    );
    run(
      "INSERT INTO ban_appeals VALUES(?,?,?,?,'open',?)",
      id(),
      userId,
      action.id,
      topicId,
      now(),
    );
    return topicId;
  });
}
export async function forumRoutes(app: FastifyInstance) {
  app.patch("/api/forum/replies/:id", async (req) => {
    const s = requireUser(req, true),
      r = one(
        "SELECT r.*,t.category,t.author_id topic_author,t.status FROM forum_replies r JOIN forum_topics t ON t.id=r.topic_id WHERE r.id=?",
        (req.params as any).id,
      );
    if (!r || r.category === "comments")
      throw new HttpError(404, "Ответ не найден");
    if (
      r.author_id !== s.user_id ||
      (s.status === "banned" &&
        (r.category !== "appeals" || r.topic_author !== s.user_id))
    )
      throw new HttpError(403, "Нет доступа");
    if (r.status === "closed") throw new HttpError(400, "Тема закрыта");
    const b = z.object({ body: z.string().min(1).max(10000) }).parse(req.body);
    run(
      "UPDATE forum_replies SET body=?,edited_at=? WHERE id=?",
      b.body,
      now(),
      r.id,
    );
    emit();
    return { ok: true };
  });
  app.get("/api/forum", async (req) => {
    const s = requireUser(req, true);
    return {
      categories: categories.filter(
        (c) => !["appeals", "support", "reports"].includes(c),
      ),
      topics: all(
        `SELECT t.*,CASE WHEN u.status IN ('banned','deletion_pending') THEN 'DELETED' ELSE u.display_name END displayName,u.type,CASE WHEN u.status='active' THEN u.derived_verified ELSE 0 END verified,CASE WHEN u.status IN ('banned','deletion_pending') THEN NULL ELSE u.avatar END avatar,(SELECT count(*) FROM forum_replies WHERE topic_id=t.id) replies FROM forum_topics t JOIN users u ON u.id=t.author_id WHERE category!='comments' AND (category NOT IN ('appeals','support','reports') OR t.author_id=? OR ?=1) ORDER BY pinned DESC,updated_at DESC LIMIT 200`,
        s.user_id,
        Number(["OWNER", "ADMIN", "MODERATOR"].includes(s.role)),
      ),
    };
  });
  app.post("/api/forum", async (req) => {
    const s = requireUser(req, true);
    const b = z
      .object({
        category: z.enum([
          "general",
          "ideas",
          "bugs",
          "administration",
          "reports",
          "appeals",
          "support",
          "announcements",
        ]),
        title: z.string().min(3).max(150),
        body: z.string().min(3).max(10000),
      })
      .parse(req.body);
    if (["appeals", "support", "reports"].includes(b.category))
      throw new HttpError(
        410,
        "Личные обращения и апелляции создаются в Notify; жалобы доступны у объекта",
      );
    if (s.status === "banned" && b.category !== "appeals")
      throw new HttpError(403, "Доступно только обжалование");
    if (
      b.category === "announcements" &&
      !["OWNER", "ADMIN", "MODERATOR"].includes(s.role)
    )
      throw new HttpError(403, "Только администрация");
    const topicId =
      b.category === "appeals"
        ? createAppeal(s.user_id, b.body)
        : createTopic(s.user_id, b.category, b.title, b.body);
    emit();
    return { id: topicId };
  });
  app.get("/api/forum/:id", async (req) => {
    const s = requireUser(req, true),
      t = one(
        "SELECT t.*,CASE WHEN u.status IN ('banned','deletion_pending') THEN 'DELETED' ELSE u.display_name END displayName,u.type,CASE WHEN u.status='active' THEN u.derived_verified ELSE 0 END verified,CASE WHEN u.status IN ('banned','deletion_pending') THEN NULL ELSE u.avatar END avatar FROM forum_topics t JOIN users u ON u.id=t.author_id WHERE t.id=?",
        (req.params as any).id,
      );
    if (!t || t.category === "comments")
      throw new HttpError(404, "Тема не найдена");
    if (
      s.status === "banned" &&
      t.author_id !== s.user_id &&
      t.category !== "announcements"
    )
      throw new HttpError(403, "Нет доступа");
    if (
      ["appeals", "support", "reports"].includes(t.category) &&
      t.author_id !== s.user_id &&
      !["OWNER", "ADMIN", "MODERATOR"].includes(s.role)
    )
      throw new HttpError(403, "Нет доступа к личному обращению");
    return {
      ...t,
      replies: all(
        "SELECT r.*,CASE WHEN u.status IN ('banned','deletion_pending') THEN 'DELETED' ELSE u.display_name END displayName,u.type,CASE WHEN u.status='active' THEN u.derived_verified ELSE 0 END verified,CASE WHEN u.status IN ('banned','deletion_pending') THEN NULL ELSE u.avatar END avatar FROM forum_replies r JOIN users u ON u.id=r.author_id WHERE topic_id=? ORDER BY created_at",
        t.id,
      ),
      appeal: one("SELECT * FROM ban_appeals WHERE topic_id=?", t.id),
    };
  });
  app.post("/api/forum/:id/replies", async (req) => {
    const s = requireUser(req, true),
      t = one("SELECT * FROM forum_topics WHERE id=?", (req.params as any).id);
    if (!t || t.category === "comments")
      throw new HttpError(404, "Тема не найдена");
    if (
      ["appeals", "support", "reports"].includes(t.category) &&
      t.author_id !== s.user_id &&
      !["OWNER", "ADMIN", "MODERATOR"].includes(s.role)
    )
      throw new HttpError(403, "Нет доступа к личному обращению");
    if (t.status === "closed") throw new HttpError(400, "Тема закрыта");
    if (
      s.status === "banned" &&
      (t.author_id !== s.user_id || t.category !== "appeals")
    )
      throw new HttpError(403, "Нет доступа");
    const b = z.object({ body: z.string().min(1).max(10000) }).parse(req.body);
    run(
      "INSERT INTO forum_replies VALUES(?,?,?,?,?,NULL)",
      id(),
      t.id,
      s.user_id,
      b.body,
      now(),
    );
    run("UPDATE forum_topics SET updated_at=? WHERE id=?", now(), t.id);
    if (t.author_id !== s.user_id)
      notify(t.author_id, "forum", b.body.slice(0, 100), t.id);
    if (
      t.author_id !== s.user_id &&
      one("SELECT id FROM users WHERE id=? AND type='ai'", t.author_id) &&
      !one(
        "SELECT 1 FROM ai_jobs WHERE agent_id=? AND kind='forum_reply' AND status IN ('queued','running') AND json_extract(payload,'$.topicId')=?",
        t.author_id,
        t.id,
      )
    )
      run(
        "INSERT INTO ai_jobs(id,agent_id,kind,payload,priority,run_at,created_at) VALUES(?,?,'forum_reply',?,12,?,?)",
        id(),
        t.author_id,
        JSON.stringify({ topicId: t.id }),
        now() + 2000,
        now(),
      );
    emit();
    return { ok: true };
  });
  app.patch("/api/forum/:id", async (req) => {
    const s = requireUser(req, true),
      t = one("SELECT * FROM forum_topics WHERE id=?", (req.params as any).id);
    if (!t || t.category === "comments") throw new HttpError(404, "Не найдено");
    const b = z
      .object({
        body: z.string().min(3).max(10000).optional(),
        status: z.enum(["open", "resolved", "closed"]).optional(),
        pinned: z.boolean().optional(),
        appealDecision: z.enum(["accepted", "rejected"]).optional(),
      })
      .parse(req.body);
    if (b.appealDecision)
      throw new HttpError(
        410,
        "Решения по апелляциям принимаются в Notify; старая тема остаётся архивом",
      );
    if (b.body !== undefined && s.user_id !== t.author_id)
      throw new HttpError(403, "Только автор");
    if (b.status || b.pinned !== undefined || b.appealDecision)
      requireAdmin(req);
    tx(() => {
      run(
        "UPDATE forum_topics SET body=?,status=?,pinned=?,updated_at=? WHERE id=?",
        b.body ?? t.body,
        b.status ?? t.status,
        b.pinned === undefined ? t.pinned : Number(b.pinned),
        now(),
        t.id,
      );
      audit(s.user_id, "forum.update", t.id, b);
    });
    emit();
    return { ok: true };
  });
}
