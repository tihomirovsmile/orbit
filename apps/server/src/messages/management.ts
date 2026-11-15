import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  all,
  one,
  run,
  tx,
  audit,
  now,
  publicUser,
} from "../database/index.js";
import {
  requireUser,
  member,
  HttpError,
  emit,
  spacePermission,
} from "../core.js";
import { reservedIdentity } from "../../../../packages/shared/policy.js";
const emojis = ["❤", "👍", "🔥", "😂", "🤔", "👀"] as const;
export async function managementRoutes(app: FastifyInstance) {
  app.get("/api/spaces/:id/ai-status", async (req) => {
    const s = requireUser(req),
      space = member(s.user_id, (req.params as any).id);
    const job = one(
      "SELECT status,error,run_at FROM ai_jobs WHERE kind='reply' AND json_extract(payload,'$.spaceId')=? ORDER BY created_at DESC LIMIT 1",
      space.id,
    );
    const simulation = (
      await import("../ai/simulation/engine.js")
    ).simulation();
    return {
      state: job?.status || "idle",
      retryAt: job?.status === "queued" ? job.run_at : null,
      error: job?.error || null,
      simulation: simulation.status,
    };
  });
  app.get("/api/spaces/:id/profile", async (req) => {
    const s = requireUser(req),
      space = member(s.user_id, (req.params as any).id);
    if (space.kind === "dm")
      throw new HttpError(400, "Откройте профиль собеседника");
    const materials = all(
      "SELECT a.id,a.mime,a.original_name name,m.id messageId FROM messages m JOIN message_media mm ON mm.message_id=m.id JOIN media_assets a ON a.id=mm.media_id WHERE m.space_id=? AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 60",
      space.id,
    );
    return {
      id: space.id,
      kind: space.kind,
      title: space.title,
      slug: space.slug,
      avatar: space.avatar,
      description: space.description,
      visibility: space.visibility,
      verified: space.verified,
      members: one(
        "SELECT count(*) n FROM space_members WHERE space_id=?",
        space.id,
      )!.n,
      joined: !!space.member,
      muted: !!space.member?.muted,
      pinned: !!space.member?.pinned,
      canManage: space.member?.role === "admin",
      allowedReactions: JSON.parse(space.allowed_reactions),
      verification: {
        type: space.verification_type,
        state: space.verification_state,
        categoryId: space.verification_category,
        country: space.funding_country,
      },
      frozen: space.frozen,
      deleteAt: space.delete_at,
      commentsMode: space.comments_mode,
      materials: space.contentUnavailable ? [] : materials,
      pinnedMessage: space.contentUnavailable
        ? null
        : one(
            "SELECT id,text FROM messages WHERE space_id=? AND pinned=1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
            space.id,
          ),
      participants:
        space.kind === "group" && space.member
          ? all(
              "SELECT u.*,sm.role member_role FROM users u JOIN space_members sm ON sm.user_id=u.id WHERE space_id=? LIMIT 100",
              space.id,
            ).map((u) => ({ ...publicUser(u), memberRole: u.member_role }))
          : undefined,
    };
  });
  app.get("/api/spaces/:id/manage", async (req) => {
    const s = requireUser(req),
      space = member(s.user_id, (req.params as any).id);
    if (space.member?.role !== "admin")
      throw new HttpError(403, "Управление доступно администраторам");
    return {
      ...space,
      members:
        space.owner_id === s.user_id ||
        JSON.parse(space.member?.permissions || "{}").members
          ? all(
              "SELECT u.*,sm.role memberRole FROM space_members sm JOIN users u ON u.id=sm.user_id WHERE space_id=?",
              space.id,
            ).map((u) => ({
              ...publicUser(u, s.user_id),
              memberRole: u.memberRole,
            }))
          : [],
      transfers: all(
        "SELECT t.*,u.display_name recipient FROM ownership_transfers t JOIN users u ON u.id=t.to_id WHERE space_id=? AND t.status='pending'",
        space.id,
      ),
      allowedReactions: JSON.parse(space.allowed_reactions),
      isOwner: space.owner_id === s.user_id,
      admins:
        space.admins_visibility === "owner" && space.owner_id !== s.user_id
          ? []
          : all(
              "SELECT u.id,u.username,u.display_name displayName,u.avatar,sm.can_publish canPublish,sm.permissions FROM space_members sm JOIN users u ON u.id=sm.user_id WHERE space_id=? AND sm.role='admin'",
              space.id,
            ),
    };
  });
  app.put("/api/spaces/:id/manage", async (req) => {
    const s = requireUser(req),
      space = member(s.user_id, (req.params as any).id);
    if (space.member?.role !== "admin")
      throw new HttpError(403, "Недостаточно прав");
    const b = z
      .object({
        title: z.string().trim().min(1).max(100),
        description: z.string().max(2000),
        slug: z.string().regex(/^[a-zA-Z0-9_-]{3,64}$/),
        avatarId: z.string().nullable().optional(),
        allowedReactions: z.array(z.enum(emojis)).max(6),
        rules: z.string().max(2000).default(""),
        visibility: z.enum(["public", "private"]),
        reactionsEnabled: z.boolean().optional(),
        showAuthor: z.boolean().optional(),
        commentsMode: z.enum(["none", "internal", "group"]).optional(),
        discussionId: z.string().nullable().optional(),
        membersVisibility: z.enum(["admins", "members"]).optional(),
        adminsVisibility: z.enum(["admins", "owner"]).optional(),
      })
      .parse(req.body);
    spacePermission(s.user_id, space, "settings");
    if (space.frozen || space.delete_at)
      throw new HttpError(423, "Настройки недоступны до восстановления");
    if (reservedIdentity(b.title) || reservedIdentity(b.slug))
      throw new HttpError(400, "Имя Notify зарезервировано");
    if (b.showAuthor !== undefined && space.owner_id !== s.user_id)
      throw new HttpError(403, "Подписи настраивает владелец");
    if (b.commentsMode === "group") {
      const group = member(s.user_id, b.discussionId || "");
      if (group.kind !== "group" || group.member?.role !== "admin")
        throw new HttpError(400, "Укажите группу, которой вы управляете");
    }
    if (
      space.owner_id !== s.user_id &&
      (b.membersVisibility !== undefined || b.adminsVisibility !== undefined)
    )
      throw new HttpError(403, "Видимость списков выбирает владелец");
    let avatar = space.avatar;
    if (b.avatarId === null) avatar = null;
    else if (b.avatarId) {
      if (
        !one(
          "SELECT id FROM media_assets WHERE id=? AND owner_id=? AND mime LIKE 'image/%'",
          b.avatarId,
          s.user_id,
        )
      )
        throw new HttpError(400, "Загрузите изображение для аватара");
      avatar = "/media/" + b.avatarId;
    }
    run(
      "UPDATE spaces SET title=?,description=?,slug=?,avatar=?,allowed_reactions=?,rules=?,visibility=?,comments_enabled=0 WHERE id=?",
      b.title,
      b.description,
      b.slug,
      avatar,
      JSON.stringify([...new Set(b.allowedReactions)]),
      b.rules,
      b.visibility,
      space.id,
    );
    run(
      "UPDATE spaces SET reactions_enabled=?,show_author=?,comments_mode=?,comments_enabled=?,discussion_id=? WHERE id=?",
      b.reactionsEnabled === undefined
        ? space.reactions_enabled
        : Number(b.reactionsEnabled),
      b.showAuthor === undefined ? space.show_author : Number(b.showAuthor),
      b.commentsMode ?? space.comments_mode,
      Number((b.commentsMode ?? space.comments_mode) !== "none"),
      b.discussionId === undefined ? space.discussion_id : b.discussionId,
      space.id,
    );
    run(
      "UPDATE spaces SET members_visibility=?,admins_visibility=? WHERE id=?",
      b.membersVisibility ?? space.members_visibility,
      b.adminsVisibility ?? space.admins_visibility,
      space.id,
    );
    audit(s.user_id, "space.configure", space.id, { title: b.title });
    emit();
    return { ok: true };
  });
  app.post("/api/spaces/:id/admins", async (req) => {
    const s = requireUser(req),
      space = member(s.user_id, (req.params as any).id);
    spacePermission(s.user_id, space, "admins");
    if (space.frozen || space.delete_at)
      throw new HttpError(423, "Сообщество недоступно");
    const b = z
      .object({
        username: z.string().min(3).max(32),
        action: z.enum(["add", "remove"]),
        canPublish: z.boolean().default(true),
        permissions: z
          .object({
            publish: z.boolean(),
            edit: z.boolean(),
            delete: z.boolean(),
            settings: z.boolean(),
            members: z.boolean(),
            admins: z.boolean(),
          })
          .optional(),
      })
      .parse(req.body);
    const u = one(
      "SELECT * FROM users WHERE username=? AND status='active'",
      b.username.replace(/^@/, ""),
    );
    if (!u)
      throw new HttpError(404, "Пользователь с таким @username не найден");
    if (u.id === space.owner_id || u.id === s.user_id)
      throw new HttpError(400, "Владелец уже имеет все права");
    if (b.action === "add")
      run(
        "INSERT INTO space_members(space_id,user_id,role,can_publish,joined_at) VALUES(?,?,'admin',?,?) ON CONFLICT(space_id,user_id) DO UPDATE SET role='admin',can_publish=excluded.can_publish",
        space.id,
        u.id,
        Number(b.canPublish),
        now(),
      );
    else
      run(
        "UPDATE space_members SET role='member' WHERE space_id=? AND user_id=?",
        space.id,
        u.id,
      );
    if (b.action === "add" && b.permissions)
      run(
        "UPDATE space_members SET permissions=? WHERE space_id=? AND user_id=?",
        JSON.stringify(b.permissions),
        space.id,
        u.id,
      );
    audit(s.user_id, "space.admin." + b.action, space.id, { target: u.id });
    emit();
    return { ok: true };
  });
  app.patch("/api/spaces/:id/preferences", async (req) => {
    const s = requireUser(req),
      space = member(s.user_id, (req.params as any).id);
    if (!space.member)
      throw new HttpError(403, "Сначала вступите в сообщество");
    const b = z
      .object({
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
        muted: z.boolean().optional(),
      })
      .parse(req.body);
    run(
      "UPDATE space_members SET pinned=?,archived=?,muted=? WHERE space_id=? AND user_id=?",
      b.pinned === undefined ? space.member.pinned : Number(b.pinned),
      b.archived === undefined ? space.member.archived : Number(b.archived),
      b.muted === undefined ? space.member.muted : Number(b.muted),
      space.id,
      s.user_id,
    );
    emit();
    return { ok: true };
  });
}
