import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { all, one, run, tx, now, id, publicUser } from "../database/index.js";
import {
  requireUser,
  member,
  createSpace,
  HttpError,
  isBlocked,
  notify,
  emit,
  activeUser,
} from "../core.js";
import { sendMessage, getMessages } from "./service.js";
import { getComments, addComment } from "./comments.js";
import { spacePermission } from "../core.js";
import { notifySpace } from "../notify/service.js";
export function spaceList(userId: string, discover = false) {
  return all(
    `SELECT s.*, (SELECT count(*) FROM space_members WHERE space_id=s.id) members,
 EXISTS(SELECT 1 FROM space_members WHERE space_id=s.id AND user_id=?) joined,
 (SELECT text FROM messages WHERE space_id=s.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) last_text,
 (SELECT max(created_at) FROM messages WHERE space_id=s.id) last_at,
 (SELECT count(*) FROM messages WHERE space_id=s.id AND sender_id!=? AND deleted_at IS NULL AND created_at>coalesce((SELECT last_read_at FROM space_members WHERE space_id=s.id AND user_id=?),0)) unread
 FROM spaces s WHERE ${discover ? "s.visibility='public' AND s.kind!='dm'" : "EXISTS(SELECT 1 FROM space_members WHERE space_id=s.id AND user_id=?)"} ORDER BY coalesce(last_at,s.created_at) DESC`,
    ...(discover ? [userId, userId, userId] : [userId, userId, userId, userId]),
  ).map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    slug: s.slug,
    description: s.description,
    visibility: s.visibility,
    ownerId: s.kind === "channel" ? undefined : s.owner_id,
    canManage:
      s.owner_id === userId ||
      one(
        "SELECT role FROM space_members WHERE space_id=? AND user_id=?",
        s.id,
        userId,
      )?.role === "admin",
    isOwner: s.owner_id === userId,
    avatar: s.avatar,
    verified: s.verified,
    allowedReactions: JSON.parse(s.allowed_reactions),
    members: s.members,
    joined: s.joined,
    membership: one(
      "SELECT role,permissions,muted,can_publish canPublish,pinned,archived FROM space_members WHERE space_id=? AND user_id=?",
      s.id,
      userId,
    ),
    lastText: s.frozen
      ? "Сообщество заморожено"
      : s.delete_at
        ? "Ожидает удаления"
        : s.last_text,
    deleteAt: s.delete_at,
    verification: {
      type: s.verification_type,
      state: s.verification_state,
      categoryId: s.verification_category,
      country: s.funding_country,
    },
    showAuthor: !!s.show_author,
    reactionsEnabled: !!s.reactions_enabled,
    commentsMode: s.comments_mode,
    lastAt: s.last_at,
    unread: s.unread,
    frozen: s.frozen,
    rules: s.rules,
    commentsEnabled: s.comments_mode !== "none",
    invite:
      s.joined && (s.kind !== "channel" || s.owner_id === userId)
        ? s.invite
        : undefined,
    otherUser:
      s.kind === "dm"
        ? publicUser(
            one(
              "SELECT u.* FROM users u JOIN space_members sm ON sm.user_id=u.id WHERE sm.space_id=? AND u.id!=?",
              s.id,
              userId,
            ),
            userId,
          )
        : undefined,
  }));
}
export async function messagingRoutes(app: FastifyInstance) {
  app.get("/api/spaces", async (req) => {
    const s = requireUser(req, true),
      system = notifySpace(s.user_id);
    return ["banned", "deletion_pending"].includes(s.status)
      ? [system].filter(Boolean)
      : [system, ...spaceList(s.user_id)].filter(Boolean);
  });
  app.get("/api/discover", async (req) => {
    const s = requireUser(req);
    const q = z
      .string()
      .max(100)
      .parse((req.query as any).q || "")
      .toLowerCase();
    const recommended = spaceList(s.user_id, true);
    if (!q) {
      const following = new Set(
        all("SELECT target_id FROM follows WHERE follower_id=?", s.user_id).map(
          (x) => x.target_id,
        ),
      );
      const familiar = new Set(
        all(
          "SELECT target_id FROM relationships WHERE user_id=? AND strength>0",
          s.user_id,
        ).map((x) => x.target_id),
      );
      const score = (x: any) =>
        Number(following.has(x.ownerId)) * 8 +
        Number(familiar.has(x.ownerId)) * 4 +
        Number(!x.joined) * 2 +
        Math.log1p(x.members) * 0.2;
      recommended.sort((a, b) => score(b) - score(a));
    }
    return {
      spaces: recommended.filter((x) =>
        (x.title + x.description).toLowerCase().includes(q),
      ),
      users: all(
        "SELECT * FROM users WHERE status!='banned' AND (display_name LIKE ? OR username LIKE ?) LIMIT 80",
        `%${q}%`,
        `%${q}%`,
      ).map((u) => publicUser(u, s.user_id)),
    };
  });
  app.post("/api/spaces", async (req) => {
    const s = requireUser(req);
    const body = z
      .object({
        kind: z.enum(["dm", "group", "channel"]),
        title: z.string().trim().min(1).max(100),
        description: z.string().max(2000).optional(),
        visibility: z.enum(["public", "private"]).default("public"),
        slug: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{3,64}$/)
          .optional(),
        members: z.array(z.string()).max(100).default([]),
        rules: z.string().max(2000).optional(),
      })
      .parse(req.body);
    return tx(() => {
      if (body.kind === "dm") {
        if (body.members.length !== 1 || body.members[0] === s.user_id)
          throw new HttpError(400, "Выберите собеседника");
        if (isBlocked(s.user_id, body.members[0]))
          throw new HttpError(403, "Общение заблокировано");
        const peer = activeUser(body.members[0]);
        if (
          peer.privacy === "contacts" &&
          !one(
            "SELECT 1 FROM follows WHERE follower_id=? AND target_id=?",
            peer.id,
            s.user_id,
          )
        )
          throw new HttpError(
            403,
            "Пользователь принимает сообщения только от контактов",
          );
        const existing = one(
          "SELECT a.space_id id FROM space_members a JOIN space_members b ON a.space_id=b.space_id JOIN spaces s ON s.id=a.space_id WHERE s.kind='dm' AND a.user_id=? AND b.user_id=?",
          s.user_id,
          body.members[0],
        );
        if (existing) return existing;
      }
      return { id: createSpace(s.user_id, body) };
    });
  });
  app.post("/api/spaces/:id/join", async (req) => {
    const s = requireUser(req);
    const { id: spaceId } = req.params as any;
    const space = one("SELECT * FROM spaces WHERE id=?", spaceId);
    if (!space || space.kind === "dm") throw new HttpError(404, "Не найдено");
    if (
      space.visibility === "private" &&
      (req.body as any)?.invite !== space.invite
    )
      throw new HttpError(403, "Нужно приглашение");
    run(
      "INSERT OR IGNORE INTO space_members(space_id,user_id,joined_at) VALUES(?,?,?)",
      spaceId,
      s.user_id,
      now(),
    );
    notify(
      space.owner_id,
      "subscriber",
      "Новый участник: " + space.title,
      spaceId,
    );
    emit();
    return { ok: true };
  });
  app.post("/api/spaces/:id/leave", async (req) => {
    const s = requireUser(req);
    const space = member(s.user_id, (req.params as any).id);
    if (space.owner_id === s.user_id)
      throw new HttpError(400, "Передайте владение перед выходом");
    run(
      "DELETE FROM space_members WHERE space_id=? AND user_id=?",
      space.id,
      s.user_id,
    );
    emit();
    return { ok: true };
  });
  app.patch("/api/spaces/:id", async (req) => {
    const s = requireUser(req),
      space = member(s.user_id, (req.params as any).id);
    spacePermission(s.user_id, space, "settings");
    if (space.frozen || space.delete_at)
      throw new HttpError(423, "Сообщество недоступно");
    const b = z
      .object({
        title: z.string().min(1).max(100).optional(),
        description: z.string().max(2000).optional(),
        rules: z.string().max(2000).optional(),
        commentsEnabled: z.boolean().optional(),
      })
      .parse(req.body);
    spacePermission(s.user_id, space, "settings");
    run(
      "UPDATE spaces SET title=?,description=?,rules=?,comments_enabled=? WHERE id=?",
      b.title ?? space.title,
      b.description ?? space.description,
      b.rules ?? space.rules,
      Number(b.commentsEnabled ?? space.comments_enabled),
      space.id,
    );
    if (b.commentsEnabled !== undefined)
      run(
        "UPDATE spaces SET comments_mode=? WHERE id=?",
        b.commentsEnabled ? "internal" : "none",
        space.id,
      );
    emit();
    return { ok: true };
  });
  app.patch("/api/spaces/:id/membership", async (req) => {
    const s = requireUser(req),
      space = member(s.user_id, (req.params as any).id);
    const b = z
      .object({
        muted: z.boolean().optional(),
        userId: z.string().optional(),
        role: z.enum(["admin", "member"]).optional(),
        remove: z.boolean().optional(),
      })
      .parse(req.body);
    if (space.frozen || space.delete_at)
      throw new HttpError(423, "Сообщество недоступно");
    if (b.userId && b.userId !== s.user_id) {
      spacePermission(s.user_id, space, b.role ? "admins" : "members");
      if (space.member?.role !== "admin" || b.userId === space.owner_id)
        throw new HttpError(403, "Недостаточно прав");
      if (b.remove)
        run(
          "DELETE FROM space_members WHERE space_id=? AND user_id=?",
          space.id,
          b.userId,
        );
      else
        run(
          "UPDATE space_members SET role=? WHERE space_id=? AND user_id=?",
          b.role || "member",
          space.id,
          b.userId,
        );
    } else
      run(
        "UPDATE space_members SET muted=? WHERE space_id=? AND user_id=?",
        Number(b.muted),
        space.id,
        s.user_id,
      );
    return { ok: true };
  });
  app.get("/api/spaces/:id/members", async (req) => {
    const s = requireUser(req);
    const space = member(s.user_id, (req.params as any).id);
    if (
      space.kind === "channel" &&
      space.owner_id !== s.user_id &&
      !(
        space.member?.role === "admin" &&
        JSON.parse(space.member.permissions || "{}").members
      ) &&
      !(space.members_visibility === "members" && space.member)
    )
      throw new HttpError(
        403,
        "Список участников канала не является публичным. Администраторы доступны только в настройках канала.",
      );
    return all(
      "SELECT u.*,sm.role member_role FROM users u JOIN space_members sm ON sm.user_id=u.id WHERE space_id=?",
      (req.params as any).id,
    ).map((u) => ({ ...publicUser(u), memberRole: u.member_role }));
  });
  app.get("/api/spaces/:id/messages", async (req) =>
    getMessages(
      requireUser(req).user_id,
      (req.params as any).id,
      (req.query as any).q || "",
      Number((req.query as any).before) || Number.MAX_SAFE_INTEGER,
    ),
  );
  app.post("/api/spaces/:id/read", async (req) => {
    const s = requireUser(req),
      space = member(s.user_id, (req.params as any).id);
    if (space.frozen || space.delete_at)
      throw new HttpError(423, "Содержимое недоступно");
    if (!space.member) return { ok: true };
    const newReads = tx(() => {
      run(
        "UPDATE space_members SET last_read_at=? WHERE space_id=? AND user_id=?",
        now(),
        space.id,
        s.user_id,
      );
      const added = run(
        "INSERT OR IGNORE INTO message_reads SELECT id,?,? FROM messages WHERE space_id=?",
        s.user_id,
        now(),
        space.id,
      );
      run(
        "UPDATE notifications SET read_at=? WHERE user_id=? AND target=?",
        now(),
        s.user_id,
        space.id,
      );
      return added.changes;
    });
    if (newReads) emit("read", { spaceId: space.id });
    return { ok: true };
  });
  app.post("/api/spaces/:id/messages", async (req) => {
    const s = requireUser(req);
    const b = z
      .object({
        text: z.string().max(10000).default(""),
        replyTo: z.string().nullable().optional(),
        mediaIds: z.array(z.string()).max(10).default([]),
        forwardedFrom: z.string().optional(),
      })
      .parse(req.body);
    if (!b.text.trim() && !b.mediaIds.length && !b.forwardedFrom)
      throw new HttpError(400, "Пустое сообщение");
    if (b.forwardedFrom) {
      const original = one(
        "SELECT * FROM messages WHERE id=? AND deleted_at IS NULL",
        b.forwardedFrom,
      );
      if (!original) throw new HttpError(404, "Не найдено");
      member(s.user_id, original.space_id);
      b.text = original.text;
    }
    return { id: sendMessage(s.user_id, (req.params as any).id, b.text, b) };
  });
  app.patch("/api/messages/:id", async (req) => {
    const s = requireUser(req),
      m = one("SELECT * FROM messages WHERE id=?", (req.params as any).id);
    if (!m || m.deleted_at) throw new HttpError(404, "Не найдено");
    const space = member(s.user_id, m.space_id);
    if (space.frozen || space.delete_at)
      throw new HttpError(423, "Сообщество недоступно");
    if (s.status !== "active") throw new HttpError(403, "Действия ограничены");
    const b = z
      .object({
        text: z.string().min(1).max(10000).optional(),
        deleted: z.boolean().optional(),
        pinned: z.boolean().optional(),
      })
      .parse(req.body);
    if (b.pinned !== undefined) {
      if (space.member?.role !== "admin")
        throw new HttpError(403, "Нужны права администратора чата");
      run("UPDATE messages SET pinned=? WHERE id=?", Number(b.pinned), m.id);
    }
    if (b.text !== undefined || b.deleted) {
      if (space.kind === "channel")
        member(s.user_id, space.id, true, b.deleted ? "delete" : "edit");
      if (
        m.sender_id !== s.user_id &&
        !(b.deleted && space.member?.role === "admin")
      )
        throw new HttpError(403, "Недостаточно прав");
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
          b.text ?? m.text,
          now(),
          b.deleted ? now() : null,
          m.id,
        );
      });
    }
    emit("messages", {
      spaceId: m.space_id,
      deletedId: b.deleted ? m.id : undefined,
    });
    return { ok: true };
  });
  app.post("/api/messages/:id/reactions", async (req) => {
    const s = requireUser(req);
    const m = one(
      "SELECT * FROM messages WHERE id=? AND deleted_at IS NULL",
      (req.params as any).id,
    );
    if (!m) throw new HttpError(404, "Не найдено");
    const space = member(s.user_id, m.space_id);
    const b = z
      .object({ emoji: z.enum(["❤", "👍", "🔥", "😂", "🤔", "👀"]) })
      .parse(req.body);
    if (
      !space.reactions_enabled ||
      (space.kind === "channel" &&
        !JSON.parse(space.allowed_reactions).includes(b.emoji))
    )
      throw new HttpError(403, "Эта реакция отключена в канале");
    if (
      one(
        "SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?",
        m.id,
        s.user_id,
        b.emoji,
      )
    )
      run(
        "DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?",
        m.id,
        s.user_id,
        b.emoji,
      );
    else {
      run("INSERT INTO reactions VALUES(?,?,?)", m.id, s.user_id, b.emoji);
      if (m.sender_id !== s.user_id)
        notify(m.sender_id, "reaction", b.emoji, m.space_id);
    }
    emit("messages", { spaceId: m.space_id });
    return { ok: true };
  });
  app.get("/api/messages/:id/comments", async (req) =>
    getComments(requireUser(req).user_id, (req.params as any).id),
  );
  app.post("/api/messages/:id/comments", async (req) => {
    const b = z
      .object({
        body: z.string().trim().min(1).max(10000),
        requestId: z.string().uuid().optional(),
      })
      .parse(req.body);
    return {
      id: addComment(
        requireUser(req).user_id,
        (req.params as any).id,
        b.body,
        b.requestId,
      ),
    };
  });
  app.post("/api/spaces/:id/schedule", async (req) => {
    const s = requireUser(req);
    const space = member(s.user_id, (req.params as any).id, true);
    const b = z
      .object({
        text: z.string().min(1).max(10000),
        publishAt: z.number().min(now()),
      })
      .parse(req.body);
    run(
      "INSERT INTO scheduled_posts VALUES(?,?,?,?,?,'pending')",
      id(),
      space.id,
      s.user_id,
      b.text,
      b.publishAt,
    );
    return { ok: true };
  });
}
