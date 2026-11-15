import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  all,
  one,
  run,
  tx,
  id,
  now,
  audit,
  publicUser,
} from "../database/index.js";
import {
  requireUser,
  requireAdmin,
  requireOwner,
  HttpError,
  emit,
} from "../core.js";
import {
  freezeTarget,
  endDecision,
  setVerification,
  requestChannelDeletion,
  cancelChannelDeletion,
  approveAccountDeletion,
  statusSummary,
  syncSanctions,
  staffActor,
} from "./service.js";
import { deliverNotify } from "../notify/service.js";
import { readableAudit } from "./audit.js";
import { reasonLabels } from "../../../../packages/shared/policy.js";
const actionBody = z.object({
  targetType: z.enum(["user", "space"]),
  targetId: z.string(),
  action: z.enum([
    "freeze",
    "restore",
    "warn",
    "restrict",
    "role",
    "permissions",
    "approve_deletion",
    "propose_deletion",
    "verification",
    "ai_pause",
    "ai_resume",
  ]),
  reason: z.string().trim().min(3).max(2000),
  reasonCode: z.string().default("other"),
  durationHours: z
    .number()
    .min(1 / 60)
    .max(24 * 365)
    .nullable()
    .optional(),
  decisionId: z.string().optional(),
  role: z.enum(["USER", "ADMIN", "MODERATOR", "SUPPORT"]).optional(),
  permissions: z
    .object({
      manageAi: z.boolean().optional(),
      createPersonas: z.boolean().optional(),
    })
    .optional(),
  verification: z
    .object({
      action: z.enum(["grant", "revoke"]),
      type: z.enum(["standard", "orbit"]).optional(),
      categoryId: z.string().optional(),
      country: z.string().optional(),
      evidence: z.string().max(2000).optional(),
    })
    .optional(),
});
export async function governanceRoutes(app: FastifyInstance) {
  app.get("/api/status/:type/:id", async (req) => {
    requireUser(req);
    const p = z
      .object({ type: z.enum(["user", "space"]), id: z.string() })
      .parse(req.params);
    if (p.type === "space") {
      const s = one("SELECT visibility FROM spaces WHERE id=?", p.id);
      const u = requireUser(req);
      if (
        s?.visibility === "private" &&
        !one(
          "SELECT 1 FROM space_members WHERE user_id=? AND space_id=?",
          u.user_id,
          p.id,
        )
      )
        throw new HttpError(403, "Нет доступа");
    }
    return statusSummary(p.type, p.id);
  });
  app.get("/api/admin/governance/users", async (req) => {
    requireAdmin(req);
    return all(
      "SELECT u.*,p.paused,p.state FROM users u LEFT JOIN ai_personas p ON p.user_id=u.id ORDER BY u.created_at DESC LIMIT 2000",
    ).map((u) => ({
      ...publicUser(u),
      displayName: u.display_name,
      avatar: u.avatar,
      publicDisplayName: publicUser(u)?.displayName,
      permissions: JSON.parse(u.permissions),
      paused: !!u.paused,
      ownedCommunities: one(
        "SELECT count(*) n FROM spaces WHERE owner_id=? AND kind!='dm'",
        u.id,
      )!.n,
    }));
  });
  app.get("/api/admin/governance/spaces", async (req) => {
    requireAdmin(req);
    return all(
      "SELECT s.*,u.display_name ownerName,u.username ownerUsername,(SELECT count(*) FROM space_members WHERE space_id=s.id) members FROM spaces s JOIN users u ON u.id=s.owner_id WHERE kind!='dm' ORDER BY s.created_at DESC",
    );
  });
  app.get("/api/admin/actions/preview", async (req) => {
    const actor = requireAdmin(req),
      b = z
        .object({
          targetType: z.enum(["user", "space"]),
          targetId: z.string(),
          action: z.string(),
        })
        .parse(req.query);
    const target = one(
      `SELECT * FROM ${b.targetType === "user" ? "users" : "spaces"} WHERE id=?`,
      b.targetId,
    );
    if (!target) throw new HttpError(404, "Объект не найден");
    return {
      target: { ...target, password_hash: undefined, permissions: undefined },
      decisions: all(
        "SELECT * FROM moderation_decisions WHERE target_type=? AND target_id=? ORDER BY starts_at DESC",
        b.targetType,
        target.id,
      ),
      communities:
        b.targetType === "user"
          ? all(
              "SELECT id,title,kind,verified,frozen FROM spaces WHERE owner_id=? AND kind!='dm'",
              target.id,
            )
          : [],
      canDelete:
        actor.role === "OWNER" &&
        b.targetType === "user" &&
        target.role !== "OWNER",
      canVerify: actor.role === "OWNER" && b.targetType === "space",
      serverNow: now(),
      reasonCodes: reasonLabels,
    };
  });
  app.post("/api/admin/actions", async (req) =>
    executeAction(req, actionBody.parse(req.body)),
  );
  app.post("/api/admin/actions/bulk", async (req) => {
    const actor = requireAdmin(req);
    const b = actionBody
      .omit({ targetId: true })
      .extend({
        targetType: z.literal("user"),
        targetIds: z.array(z.string().min(1)).min(1).max(100),
        requestKey: z.string().uuid(),
        action: z.enum([
          "freeze",
          "warn",
          "restrict",
          "ai_pause",
          "ai_resume",
          "role",
          "propose_deletion",
          "approve_deletion",
        ]),
      })
      .parse(req.body);
    if (new Set(b.targetIds).size !== b.targetIds.length)
      throw new HttpError(400, "Уберите повторяющиеся аккаунты");
    const key = "bulk:" + actor.user_id + ":" + b.requestKey;
    return tx(() => {
      const previous = one(
        "SELECT value FROM system_settings WHERE key=?",
        key,
      );
      const fingerprint = JSON.stringify(b);
      if (previous) {
        const cached = JSON.parse(previous.value);
        if (cached.fingerprint !== fingerprint)
          throw new HttpError(
            409,
            "Этот запрос уже использован для другого действия",
          );
        return cached.response;
      }
      const results = b.targetIds.map((targetId) => {
        try {
          tx(() => executeAction(req, { ...b, targetId }));
          return { targetId, ok: true };
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          return { targetId, ok: false, error: error.message };
        }
      });
      const response = { results };
      run(
        "INSERT INTO system_settings(key,value) VALUES(?,?)",
        key,
        JSON.stringify({ fingerprint, response }),
      );
      return response;
    });
  });
  app.get("/api/admin/audit-log", async (req) => {
    requireAdmin(req);
    const q = req.query as any,
      limit = Math.max(1, Math.min(500, Number(q.limit) || 100));
    let rows = all(
      `SELECT a.rowid cursor,a.*,u.display_name actorName FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.rowid<? AND (?='' OR a.actor_id=?) AND (?='' OR a.target=?) AND (?='' OR a.action=?) AND a.created_at>=? AND a.created_at<=? AND (?='' OR a.detail LIKE ? OR u.display_name LIKE ? OR a.action LIKE ?) ORDER BY a.rowid DESC LIMIT ?`,
      Number(q.before) || Number.MAX_SAFE_INTEGER,
      q.actor || "",
      q.actor || "",
      q.target || "",
      q.target || "",
      q.action || "",
      q.action || "",
      Number(q.from) || 0,
      Number(q.to) || Number.MAX_SAFE_INTEGER,
      q.q || "",
      `%${String(q.q || "").slice(0, 100)}%`,
      `%${String(q.q || "").slice(0, 100)}%`,
      `%${String(q.q || "").slice(0, 100)}%`,
      limit,
    );
    return {
      items: readableAudit(rows),
      nextCursor: rows.length === limit ? rows.at(-1)?.cursor : null,
    };
  });
  app.get("/api/verification/categories", async (req) => {
    requireUser(req);
    return all("SELECT * FROM verification_categories ORDER BY rowid");
  });
  app.post("/api/admin/verification/categories", async (req) => {
    const s = requireOwner(req),
      b = z
        .object({
          id: z.string().optional(),
          name: z.string().trim().min(2).max(60),
          style: z.enum(["standard", "company", "diamond"]),
          deriveBadge: z.boolean().default(false),
          requiresCountry: z.boolean().default(false),
          description: z.string().max(500).default(""),
        })
        .parse(req.body),
      categoryId = b.id || id();
    run(
      "INSERT INTO verification_categories VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,style=excluded.style,derive_badge=excluded.derive_badge,requires_country=excluded.requires_country,description=excluded.description",
      categoryId,
      b.name,
      b.style,
      Number(b.deriveBadge),
      Number(b.requiresCountry),
      b.description,
    );
    audit(s.user_id, "verification.category", categoryId, { name: b.name });
    syncSanctions("category:" + categoryId + now());
    return { id: categoryId };
  });
  app.post("/api/spaces/:id/delete", async (req) => ({
    deleteAt: requestChannelDeletion(
      requireUser(req).user_id,
      (req.params as any).id,
    ),
    serverNow: now(),
  }));
  app.post("/api/spaces/:id/cancel-delete", async (req) => {
    cancelChannelDeletion(requireUser(req).user_id, (req.params as any).id);
    return { ok: true };
  });
  app.get("/api/spaces/:id/verification-history", async (req) => {
    const s = requireUser(req),
      space = one("SELECT * FROM spaces WHERE id=?", (req.params as any).id);
    if (
      !space ||
      !one(
        "SELECT 1 FROM space_members WHERE space_id=? AND user_id=? AND role='admin'",
        space.id,
        s.user_id,
      )
    )
      throw new HttpError(403, "История доступна в управлении сообществом");
    return all(
      "SELECT action,status_type type,category_id categoryId,country,reason,evidence,created_at createdAt FROM verification_history WHERE space_id=? ORDER BY created_at DESC",
      space.id,
    );
  });
}
function ioUpdate(_userId: string) {
  emit("account-status", {});
  emit();
}

function executeAction(req: FastifyRequest, b: z.infer<typeof actionBody>) {
  const s = requireAdmin(req),
    target = one(
      `SELECT * FROM ${b.targetType === "user" ? "users" : "spaces"} WHERE id=?`,
      b.targetId,
    );
  if (!target) throw new HttpError(404, "Объект не найден");
  if (
    b.targetType === "user" &&
    target.role === "OWNER" &&
    !["ai_pause", "ai_resume"].includes(b.action)
  )
    throw new HttpError(
      403,
      "Единственный владелец защищён от санкций и смены роли",
    );
  if (
    b.targetType === "user" &&
    s.role === "MODERATOR" &&
    ["ADMIN", "MODERATOR"].includes(target.role)
  )
    throw new HttpError(
      403,
      "Модератор не может изменять полномочия и санкции сотрудников",
    );
  if (b.action === "freeze")
    return { id: freezeTarget(s.user_id, b.targetType, b.targetId, b) };
  if (b.action === "restore") {
    if (!b.decisionId)
      throw new HttpError(400, "Выберите конкретное решение для отмены");
    const d = one(
      "SELECT target_type,target_id FROM moderation_decisions WHERE id=?",
      b.decisionId,
    );
    if (d?.target_type !== b.targetType || d?.target_id !== b.targetId)
      throw new HttpError(400, "Решение относится к другому объекту");
    endDecision(s.user_id, b.decisionId, b.reason);
    return { ok: true };
  }
  if (b.action === "verification") {
    if (b.targetType !== "space" || !b.verification)
      throw new HttpError(400, "Выберите параметры статуса сообщества");
    return {
      id: setVerification(s.user_id, b.targetId, {
        ...b.verification,
        reason: b.reason,
      }),
    };
  }
  if (b.action === "approve_deletion") {
    if (b.targetType !== "user")
      throw new HttpError(403, "Чужой канал удаляет только его владелец");
    return {
      deleteAt: approveAccountDeletion(s.user_id, b.targetId, b.reason),
    };
  }
  if (b.action === "propose_deletion") {
    if (b.targetType !== "user")
      throw new HttpError(400, "Предложение относится к аккаунту");
    const ticketId = id();
    tx(() => {
      run(
        "INSERT INTO support_tickets(id,user_id,kind,target_type,target_id,status,subject,body,request_key,created_at,updated_at) VALUES(?,?,'deletion_proposal','user',?,'queued',?,?,?,?,?)",
        ticketId,
        target.id,
        target.id,
        "Предложение удаления аккаунта",
        b.reason,
        "staff:" + ticketId,
        now(),
        now(),
      );
      audit(s.user_id, "account.deletion_proposed", target.id, {
        ticketId,
        reason: b.reason,
      });
      deliverNotify(target.id, {
        key: `delete-proposal:${ticketId}`,
        kind: "DELETION_PROPOSED",
        title: "Администрация предложила удаление аккаунта",
        body: "Это предложение передано владельцу Orbit. Удаление ещё не началось. Вы можете дополнить обращение в поддержку.",
        importance: "high",
        ticketId,
      });
    });
    emit("support-queue");
    return { id: ticketId };
  }
  if (["role", "permissions"].includes(b.action)) {
    requireOwner(req);
    if (b.targetType !== "user" || target.type !== "human")
      throw new HttpError(
        403,
        "Административные полномочия доступны только людям",
      );
    if (b.action === "role" && !b.role)
      throw new HttpError(400, "Выберите роль");
    tx(() => {
      run(
        "UPDATE users SET role=?,permissions=? WHERE id=?",
        b.role || target.role,
        JSON.stringify(b.permissions || JSON.parse(target.permissions)),
        target.id,
      );
      audit(s.user_id, "role.changed", target.id, {
        role: b.role || target.role,
        permissions: b.permissions,
        reason: b.reason,
      });
      deliverNotify(target.id, {
        key: `role:${id()}`,
        kind: "ADMIN_ROLE_CHANGED",
        title: "Ваши полномочия изменены",
        body: b.reason,
        importance: "critical",
      });
    });
    ioUpdate(target.id);
    return { ok: true };
  }
  if (["ai_pause", "ai_resume"].includes(b.action)) {
    requireOwner(req);
    if (target.type !== "ai")
      throw new HttpError(400, "Выберите нейропользователя");
    run(
      "UPDATE ai_personas SET paused=? WHERE user_id=?",
      b.action === "ai_pause" ? 1 : 0,
      target.id,
    );
    audit(s.user_id, b.action, target.id, { reason: b.reason });
    emit();
    return { ok: true };
  }
  if (["warn", "restrict"].includes(b.action)) {
    if (b.targetType !== "user")
      throw new HttpError(
        400,
        "Предупреждение или ограничение относится к аккаунту",
      );
    staffActor(s.user_id);
    const decisionId = id();
    tx(() => {
      run(
        "INSERT INTO moderation_decisions(id,target_type,target_id,action,reason_code,reason,actor_id,starts_at,expires_at,public_reason) VALUES(?,'user',?,?,?,?,?,?,?,?)",
        decisionId,
        target.id,
        b.action,
        b.reasonCode,
        b.reason,
        s.user_id,
        now(),
        b.durationHours ? now() + b.durationHours * 3600000 : null,
        reasonLabels[b.reasonCode] || reasonLabels.other,
      );
      audit(s.user_id, "moderation." + b.action, target.id, {
        reason: b.reason,
        decisionId,
      });
      deliverNotify(target.id, {
        key: `decision:${decisionId}`,
        kind: "ACCOUNT_RESTRICTED",
        title:
          b.action === "warn"
            ? "Предупреждение Orbit"
            : "Отправка сообщений ограничена",
        body: b.reason,
        importance: "high",
        objectType: "user",
        objectId: target.id,
        decisionId,
      });
      syncSanctions(decisionId);
    });
    return { id: decisionId };
  }
  throw new HttpError(400, "Действие недоступно для этого объекта");
}
