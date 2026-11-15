import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { all, one, run, now, publicUser, id, tx } from "../database/index.js";
import {
  requireUser,
  requireAdmin,
  HttpError,
  isBlocked,
  notify,
  member,
} from "../core.js";
import {
  reservedIdentity,
  calculateAge,
} from "../../../../packages/shared/policy.js";
import { createReport } from "../governance/reports.js";
export async function userRoutes(app: FastifyInstance) {
  app.get("/api/users/:id/materials", async (req) => {
    const s = requireUser(req),
      target = (req.params as any).id;
    const common = all(
      "SELECT s.id,s.title,s.kind,s.slug FROM spaces s JOIN space_members a ON a.space_id=s.id JOIN space_members b ON b.space_id=s.id WHERE a.user_id=? AND b.user_id=? AND s.kind='group' LIMIT 50",
      s.user_id,
      target,
    );
    const materials = all(
      "SELECT a.id,a.mime,a.original_name name,m.space_id spaceId FROM media_assets a JOIN message_media mm ON mm.media_id=a.id JOIN messages m ON m.id=mm.message_id JOIN spaces sp ON sp.id=m.space_id JOIN space_members x ON x.space_id=sp.id AND x.user_id=? JOIN space_members y ON y.space_id=sp.id AND y.user_id=? WHERE sp.kind='dm' AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 60",
      s.user_id,
      target,
    );
    return { common, materials };
  });
  app.get("/api/users/:id", async (req) => {
    const s = requireUser(req, true),
      u = one(
        "SELECT u.*,p.state FROM users u LEFT JOIN ai_personas p ON p.user_id=u.id WHERE u.id=?",
        (req.params as any).id,
      );
    if (!u) throw new HttpError(404, "Не найдено");
    const result: any = {
      ...publicUser(u, s.user_id),
      languages: all(
        "SELECT language,proficiency FROM user_languages WHERE user_id=?",
        u.id,
      ),
      followers: one("SELECT count(*) n FROM follows WHERE target_id=?", u.id)!
        .n,
      following: !!one(
        "SELECT 1 FROM follows WHERE follower_id=? AND target_id=?",
        s.user_id,
        u.id,
      ),
      blocked: isBlocked(s.user_id, u.id),
    };
    if (["OWNER", "ADMIN"].includes(s.role) && u.type === "ai") {
      result.persona = one("SELECT * FROM ai_personas WHERE user_id=?", u.id);
      result.memories = all(
        "SELECT * FROM agent_memories WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
        u.id,
      );
      result.relationships = all(
        "SELECT r.*,u.display_name FROM relationships r JOIN users u ON u.id=r.target_id WHERE r.user_id=?",
        u.id,
      );
    }
    return result;
  });
  app.patch("/api/users/me", async (req) => {
    const s = requireUser(req);
    const b = z
      .object({
        displayName: z.string().trim().min(1).max(60),
        bio: z.string().max(1000),
        language: z.enum(["ru", "uk", "en", "it", "es"]),
        country: z.string().max(80).default(""),
        privacy: z.enum(["everyone", "contacts"]).default("everyone"),
        birthDate: z
          .string()
          .nullable()
          .refine(
            (v) => v === null || calculateAge(v) !== null,
            "Некорректная дата",
          )
          .optional(),
        presenceVisibility: z
          .enum(["everyone", "contacts", "nobody"])
          .optional(),
        avatar: z.string().nullable().optional(),
        username: z
          .string()
          .regex(/^[a-zA-Z0-9_.]{3,32}$/)
          .optional(),
      })
      .parse(req.body);
    if (
      reservedIdentity(b.displayName) ||
      (b.username && reservedIdentity(b.username))
    )
      throw new HttpError(400, "Имя Notify зарезервировано системой");
    if (
      b.avatar &&
      !one(
        "SELECT id FROM media_assets WHERE id=? AND owner_id=? AND mime LIKE 'image/%'",
        b.avatar,
        s.user_id,
      )
    )
      throw new HttpError(400, "Выберите загруженный вами аватар");
    tx(() => {
      run(
        "UPDATE users SET display_name=?,bio=?,language=?,country=?,privacy=?,avatar=coalesce(?,avatar) WHERE id=?",
        b.displayName,
        b.bio,
        b.language,
        b.country,
        b.privacy,
        b.avatar ? `/media/${b.avatar}` : null,
        s.user_id,
      );
      run(
        "UPDATE users SET birth_date=?,presence_visibility=? WHERE id=?",
        b.birthDate === undefined
          ? one("SELECT birth_date FROM users WHERE id=?", s.user_id)
              ?.birth_date
          : b.birthDate,
        b.presenceVisibility ??
          one("SELECT presence_visibility FROM users WHERE id=?", s.user_id)
            ?.presence_visibility,
        s.user_id,
      );
      if (b.username)
        run("UPDATE users SET username=? WHERE id=?", b.username, s.user_id);
    });
    return publicUser(one("SELECT * FROM users WHERE id=?", s.user_id));
  });
  app.post("/api/users/:id/follow", async (req) => {
    const s = requireUser(req),
      target = (req.params as any).id;
    if (target === s.user_id || !one("SELECT id FROM users WHERE id=?", target))
      throw new HttpError(400, "Недопустимый пользователь");
    if (
      one(
        "SELECT 1 FROM follows WHERE follower_id=? AND target_id=?",
        s.user_id,
        target,
      )
    )
      run(
        "DELETE FROM follows WHERE follower_id=? AND target_id=?",
        s.user_id,
        target,
      );
    else {
      run("INSERT INTO follows VALUES(?,?,?)", s.user_id, target, now());
      notify(target, "follow", "Новый подписчик", s.user_id);
    }
    return { ok: true };
  });
  app.post("/api/users/:id/block", async (req) => {
    const s = requireUser(req),
      target = (req.params as any).id;
    if (target === s.user_id)
      throw new HttpError(400, "Нельзя блокировать себя");
    if (
      one(
        "SELECT 1 FROM blocks WHERE user_id=? AND target_id=?",
        s.user_id,
        target,
      )
    )
      run(
        "DELETE FROM blocks WHERE user_id=? AND target_id=?",
        s.user_id,
        target,
      );
    else run("INSERT INTO blocks VALUES(?,?)", s.user_id, target);
    return { ok: true };
  });
  app.get("/api/notifications", async (req) =>
    all(
      "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
      requireUser(req, true).user_id,
    ),
  );
  app.post("/api/notifications/read", async (req) => {
    run(
      "UPDATE notifications SET read_at=? WHERE user_id=?",
      now(),
      requireUser(req, true).user_id,
    );
    return { ok: true };
  });
  app.post("/api/reports", async (req) => {
    const s = requireUser(req);
    const b = z
      .object({
        targetId: z.string(),
        targetType: z.enum(["user", "space"]).optional(),
        reasonCode: z.string().optional(),
        comment: z.string().max(2000).optional(),
        reason: z.string().min(3).max(2000).optional(),
        evidenceMessageId: z.string().optional(),
      })
      .parse(req.body);
    return { id: createReport(s.user_id, b), ok: true };
  });
}
