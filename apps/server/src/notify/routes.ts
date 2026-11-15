import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { all, one, run, now, tx, audit } from "../database/index.js";
import { requireUser, HttpError, emit } from "../core.js";
import { ensureNotify, restrictedAccount, ownDecisions } from "./service.js";
import {
  createTicket,
  getTicket,
  replyTicket,
  updateTicket,
  supportActor,
  ticketAccess,
  activateQueued,
} from "./tickets.js";
import {
  cancelAccountDeletion,
  cancelChannelDeletion,
} from "../governance/service.js";
const ticketBody = z.object({
  kind: z.enum(["appeal", "support", "deletion", "verification", "data"]),
  decisionId: z.string().optional(),
  targetType: z.enum(["user", "space"]).optional(),
  targetId: z.string().optional(),
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(10000),
  mediaIds: z.array(z.string()).max(10).default([]),
  requestKey: z.string().uuid(),
  newEvidence: z.boolean().optional(),
});
export async function notifyRoutes(app: FastifyInstance) {
  app.get("/api/notify", async (req) => {
    const s = requireUser(req, true);
    ensureNotify(s.user_id);
    return {
      ...restrictedAccount(s.user_id),
      inbox: one(
        "SELECT hidden,muted FROM notify_inboxes WHERE user_id=?",
        s.user_id,
      ),
      events: all(
        "SELECT id,kind,title,body,importance,object_type objectType,object_id objectId,decision_id decisionId,ticket_id ticketId,payload,created_at createdAt,delivered_at deliveredAt,read_at readAt FROM notify_events WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200",
        s.user_id,
      )
        .reverse()
        .map((e) => ({ ...e, payload: JSON.parse(e.payload) })),
      tickets: all(
        "SELECT id,kind,subject,status,decision_id decisionId,created_at createdAt,updated_at updatedAt FROM support_tickets WHERE user_id=? ORDER BY updated_at DESC",
        s.user_id,
      ),
    };
  });
  app.get("/api/notify/decisions", async (req) =>
    ownDecisions(requireUser(req, true).user_id),
  );
  app.post("/api/notify/ack", async (req) => {
    const s = requireUser(req, true),
      b = z
        .object({
          ids: z.array(z.string()).max(200),
          read: z.boolean().default(false),
        })
        .parse(req.body);
    tx(() => {
      for (const eventId of b.ids)
        run(
          "UPDATE notify_events SET delivered_at=coalesce(delivered_at,?),read_at=CASE WHEN ? THEN coalesce(read_at,?) ELSE read_at END WHERE id=? AND user_id=?",
          now(),
          b.read ? 1 : 0,
          now(),
          eventId,
          s.user_id,
        );
    });
    return { ok: true };
  });
  app.patch("/api/notify/preferences", async (req) => {
    const s = requireUser(req, true),
      b = z
        .object({
          hidden: z.boolean().optional(),
          muted: z.boolean().optional(),
        })
        .parse(req.body);
    ensureNotify(s.user_id);
    if (b.hidden && s.status !== "active")
      throw new HttpError(403, "Notify нельзя скрыть в ограниченном режиме");
    run(
      "UPDATE notify_inboxes SET hidden=coalesce(?,hidden),muted=coalesce(?,muted) WHERE user_id=?",
      b.hidden === undefined ? null : Number(b.hidden),
      b.muted === undefined ? null : Number(b.muted),
      s.user_id,
    );
    return { ok: true };
  });
  app.post("/api/notify/tickets", async (req) => ({
    id: createTicket(
      requireUser(req, true).user_id,
      ticketBody.parse(req.body),
    ),
  }));
  app.get("/api/notify/tickets/:id", async (req) =>
    getTicket(requireUser(req, true).user_id, (req.params as any).id),
  );
  app.post("/api/notify/tickets/:id/messages", async (req) => {
    const b = z
      .object({
        body: z.string().trim().min(1).max(10000),
        mediaIds: z.array(z.string()).max(10).default([]),
        requestKey: z.string().uuid(),
      })
      .parse(req.body);
    return {
      id: replyTicket(
        requireUser(req, true).user_id,
        (req.params as any).id,
        b,
      ),
    };
  });
  app.post("/api/notify/tickets/:id/withdraw", async (req) => {
    const s = requireUser(req, true),
      t = ticketAccess(s.user_id, (req.params as any).id);
    if (["accepted", "rejected", "closed", "withdrawn"].includes(t.status))
      throw new HttpError(409, "Обращение закрыто");
    tx(() => {
      run(
        "UPDATE support_tickets SET status='withdrawn',updated_at=? WHERE id=?",
        now(),
        t.id,
      );
      audit(s.user_id, "ticket.withdrawn", t.id, {});
      activateQueued(s.user_id);
    });
    emit("support-queue");
    return { ok: true };
  });
  app.post("/api/notify/cancel-deletion", async (req) => {
    cancelAccountDeletion(requireUser(req, true).user_id);
    return { ok: true };
  });
  app.post("/api/notify/cancel-channel-deletion", async (req) => {
    const s = requireUser(req, true),
      b = z.object({ spaceId: z.string() }).parse(req.body);
    cancelChannelDeletion(s.user_id, b.spaceId);
    return { ok: true };
  });
  app.get("/api/notify/help", async (req) => {
    requireUser(req, true);
    return {
      title: "Правила и поддержка Orbit",
      rules: [
        "Уважайте приватность и личные границы.",
        "Не публикуйте мошеннические предложения, угрозы, травлю и запрещённый контент.",
        "Жалобы рассматривает уполномоченный сотрудник, а не счётчик жалоб.",
        "Если решение ошибочно, откройте обжалование в Notify и приложите относящиеся к делу доказательства.",
        "Поддержка никогда не запрашивает пароли и коды подтверждения.",
      ],
      support:
        "Подать обращение можно в Notify. Срок ответа не гарантируется. Если вход невозможен, используйте контакт поддержки из настроек сети, если владелец его опубликовал.",
    };
  });
  app.get("/api/admin/support", async (req) => {
    const s = requireUser(req),
      actor = supportActor(s.user_id),
      q = req.query as any;
    let tickets = all(
      "SELECT t.*,u.username,u.display_name applicantName FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE (?='OWNER' OR t.assigned_to IS NULL OR t.assigned_to=?) ORDER BY t.updated_at DESC LIMIT 500",
      actor.role,
      s.user_id,
    );
    if (q.status) tickets = tickets.filter((t) => t.status === q.status);
    if (q.kind) tickets = tickets.filter((t) => t.kind === q.kind);
    if (q.q)
      tickets = tickets.filter((t) =>
        (t.subject + " " + t.applicantName + " " + t.id)
          .toLowerCase()
          .includes(String(q.q).toLowerCase()),
      );
    return tickets.map((t) =>
      actor.role !== "OWNER" && t.assigned_to !== s.user_id
        ? {
            id: t.id,
            user_id: t.user_id,
            kind: t.kind,
            subject: t.subject,
            status: t.status,
            created_at: t.created_at,
            updated_at: t.updated_at,
            applicantName: t.applicantName,
            needsAssignment: true,
          }
        : t,
    );
  });
  app.get("/api/admin/support/:id", async (req) =>
    getTicket(requireUser(req).user_id, (req.params as any).id, true),
  );
  app.post("/api/admin/support/:id/messages", async (req) => {
    const b = z
      .object({
        body: z.string().trim().min(1).max(10000),
        mediaIds: z.array(z.string()).max(10).default([]),
        requestKey: z.string().uuid(),
      })
      .parse(req.body);
    return {
      id: replyTicket(
        requireUser(req).user_id,
        (req.params as any).id,
        b,
        true,
      ),
    };
  });
  app.patch("/api/admin/support/:id", async (req) => {
    const b = z
      .object({
        action: z.enum([
          "assign",
          "active",
          "waiting_user",
          "escalated",
          "accepted",
          "rejected",
          "closed",
        ]),
        reason: z.string().max(10000).optional(),
        assigneeId: z.string().optional(),
        verification: z
          .object({
            type: z.enum(["standard", "orbit"]),
            categoryId: z.string().optional(),
            country: z.string().optional(),
            evidence: z.string().max(2000).optional(),
          })
          .optional(),
      })
      .parse(req.body);
    updateTicket(requireUser(req).user_id, (req.params as any).id, b);
    return { ok: true };
  });
}
