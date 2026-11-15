import { createHash } from "node:crypto";
import { all, one, run, tx, id, now, audit } from "../database/index.js";
import { HttpError, emit } from "../core.js";
import {
  closedTicketStatuses,
  ticketStatusLabels,
} from "../../../../packages/shared/policy.js";
import { deliverNotify } from "./service.js";
import {
  endDecision,
  approveAccountDeletion,
  setVerification,
  staffActor,
} from "../governance/service.js";
import { validateAttachments } from "../media/limits.js";
export function supportActor(userId: string) {
  const u = one("SELECT * FROM users WHERE id=?", userId);
  if (
    !u ||
    u.type !== "human" ||
    u.status !== "active" ||
    !["OWNER", "ADMIN", "MODERATOR", "SUPPORT"].includes(u.role)
  )
    throw new HttpError(403, "Требуются полномочия поддержки");
  return u;
}
export function ticketAccess(userId: string, ticketId: string, staff = false) {
  const ticket = one("SELECT * FROM support_tickets WHERE id=?", ticketId);
  if (!ticket) throw new HttpError(404, "Обращение не найдено");
  if (staff) {
    const actor = supportActor(userId);
    if (actor.role !== "OWNER" && ticket.assigned_to !== userId)
      throw new HttpError(403, "Обращение назначено другому сотруднику");
  } else if (ticket.user_id !== userId)
    throw new HttpError(403, "Нет доступа к чужому обращению");
  return ticket;
}
function attachments(
  userId: string,
  ticketId: string,
  mediaIds: string[],
  messageId?: string,
) {
  validateAttachments(mediaIds);
  for (const mediaId of new Set(mediaIds)) {
    if (
      !one(
        "SELECT id FROM media_assets WHERE id=? AND owner_id=?",
        mediaId,
        userId,
      )
    )
      throw new HttpError(403, "Выберите собственные загруженные файлы");
    run(
      "INSERT OR IGNORE INTO ticket_media VALUES(?,?,?)",
      ticketId,
      messageId || null,
      mediaId,
    );
  }
}
export function createTicket(
  userId: string,
  b: {
    kind: string;
    decisionId?: string;
    targetType?: string;
    targetId?: string;
    subject: string;
    body: string;
    mediaIds?: string[];
    requestKey: string;
    newEvidence?: boolean;
  },
) {
  const user = one("SELECT * FROM users WHERE id=?", userId);
  if (!user) throw new HttpError(401, "Требуется вход");
  const repeated = one(
    "SELECT id FROM support_tickets WHERE user_id=? AND request_key=?",
    userId,
    b.requestKey,
  );
  if (repeated) return repeated.id;
  if (
    !["appeal", "support", "deletion", "verification", "data"].includes(b.kind)
  )
    throw new HttpError(400, "Неизвестный тип обращения");
  let decision: any = null;
  if (
    ["banned", "deletion_pending"].includes(user.status) &&
    !["appeal", "deletion", "data"].includes(b.kind)
  )
    throw new HttpError(
      403,
      "В ограниченном режиме доступны обжалование, данные и удаление",
    );
  if (b.kind === "appeal") {
    decision = one(
      "SELECT * FROM moderation_decisions WHERE id=?",
      b.decisionId,
    );
    if (!decision) throw new HttpError(404, "Решение не найдено");
    if (decision.parent_id)
      decision =
        one(
          "SELECT * FROM moderation_decisions WHERE id=?",
          decision.parent_id,
        ) || decision;
    const owned =
      decision.target_type === "user"
        ? decision.target_id === userId
        : !!one(
            "SELECT id FROM spaces WHERE id=? AND owner_id=?",
            decision.target_id,
            userId,
          );
    if (!owned)
      throw new HttpError(
        403,
        "Решение не относится к вашему аккаунту или сообществу",
      );
    if (!decision.active)
      throw new HttpError(409, "Решение уже отменено или срок завершился");
    const existing = one(
      "SELECT id FROM support_tickets WHERE user_id=? AND decision_id=? AND status NOT IN ('accepted','rejected','closed','withdrawn')",
      userId,
      decision.id,
    );
    if (existing) return existing.id;
    if (
      one(
        "SELECT 1 FROM support_tickets WHERE user_id=? AND decision_id=? AND status='rejected'",
        userId,
        decision.id,
      ) &&
      !b.newEvidence
    )
      throw new HttpError(
        409,
        "Для повторного обжалования отметьте наличие новых доказательств и приложите их либо опишите новые обстоятельства",
      );
  }
  if (b.kind === "verification") {
    if (user.status !== "active")
      throw new HttpError(
        403,
        "Выдача статуса недоступна в ограниченном режиме",
      );
    const space = one(
      "SELECT * FROM spaces WHERE id=? AND kind!='dm'",
      b.targetId,
    );
    if (
      !space ||
      (space.owner_id !== userId && !["OWNER", "ADMIN"].includes(user.role))
    )
      throw new HttpError(
        403,
        "Заявку подаёт владелец сообщества или администратор Orbit",
      );
  }
  if (b.kind === "deletion" && user.role === "OWNER")
    throw new HttpError(
      409,
      "Единственный владелец Orbit не может удалить свой аккаунт",
    );
  if (
    one(
      "SELECT count(*) n FROM support_tickets WHERE user_id=? AND status NOT IN ('accepted','rejected','closed','withdrawn')",
      userId,
    )!.n >= 20
  )
    throw new HttpError(
      429,
      "У вас уже 20 открытых обращений. Дополните существующее обращение.",
    );
  const ticketId = id();
  tx(() => {
    const status = one(
      "SELECT 1 FROM support_tickets WHERE user_id=? AND status IN ('active','waiting_user','escalated')",
      userId,
    )
      ? "queued"
      : "active";
    run(
      "INSERT INTO support_tickets(id,user_id,kind,decision_id,target_type,target_id,status,subject,body,request_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ticketId,
      userId,
      b.kind,
      decision?.id || null,
      decision?.target_type || b.targetType || null,
      decision?.target_id || b.targetId || null,
      status,
      b.subject,
      b.body,
      b.requestKey,
      now(),
      now(),
    );
    const messageId = id();
    run(
      "INSERT INTO ticket_messages VALUES(?,?,'user',?,?,?)",
      messageId,
      ticketId,
      userId,
      b.body,
      now(),
    );
    attachments(userId, ticketId, b.mediaIds || [], messageId);
    audit(userId, "ticket.created", ticketId, {
      kind: b.kind,
      decisionId: decision?.id,
    });
    deliverNotify(userId, {
      key: `ticket-created:${ticketId}`,
      kind: "APPEAL_SUBMITTED",
      title: "Обращение зарегистрировано",
      body: `Обращение №${ticketId.slice(0, 8)}. ${ticketStatusLabels[status]}. Ответы поддержки появятся в карточке обращения.`,
      importance: "high",
      ticketId,
      decisionId: decision?.id,
    });
  });
  emit("support-queue");
  return ticketId;
}
export function getTicket(userId: string, ticketId: string, staff = false) {
  const ticket = ticketAccess(userId, ticketId, staff);
  return {
    ...ticket,
    assigned_to: staff ? ticket.assigned_to : undefined,
    messages: all(
      "SELECT id,author_type authorType,body,created_at createdAt FROM ticket_messages WHERE ticket_id=? ORDER BY created_at,rowid",
      ticket.id,
    ),
    media: all(
      "SELECT m.id,m.original_name name,m.mime,m.size,tm.message_id messageId FROM ticket_media tm JOIN media_assets m ON m.id=tm.media_id WHERE tm.ticket_id=?",
      ticket.id,
    ),
    decision: ticket.decision_id
      ? one(
          "SELECT id,target_type targetType,target_id targetId,reason_code reasonCode,reason,public_reason publicReason,starts_at startsAt,expires_at expiresAt,active,ended_at endedAt,end_reason endReason FROM moderation_decisions WHERE id=?",
          ticket.decision_id,
        )
      : null,
    serverNow: now(),
  };
}
export function replyTicket(
  userId: string,
  ticketId: string,
  b: { body: string; mediaIds?: string[]; requestKey: string },
  staff = false,
) {
  const ticket = ticketAccess(userId, ticketId, staff);
  if (closedTicketStatuses.includes(ticket.status))
    throw new HttpError(409, "Обращение закрыто");
  const messageId = createHash("sha256")
    .update(`${ticket.id}:${userId}:${b.requestKey}`)
    .digest("hex");
  tx(() => {
    if (
      !run(
        "INSERT OR IGNORE INTO ticket_messages VALUES(?,?,?,?,?,?)",
        messageId,
        ticket.id,
        staff ? "support" : "user",
        userId,
        b.body,
        now(),
      ).changes
    )
      return;
    attachments(userId, ticket.id, b.mediaIds || [], messageId);
    if (!staff && ticket.status === "waiting_user")
      run(
        "UPDATE support_tickets SET status='active',updated_at=? WHERE id=?",
        now(),
        ticket.id,
      );
    else
      run(
        "UPDATE support_tickets SET updated_at=? WHERE id=?",
        now(),
        ticket.id,
      );
    audit(
      userId,
      staff ? "ticket.support_reply" : "ticket.user_reply",
      ticket.id,
      { messageId },
    );
    if (staff)
      deliverNotify(ticket.user_id, {
        key: `ticket-message:${messageId}`,
        kind: "APPEAL_UPDATED",
        title: "Ответ поддержки Orbit",
        body: `Новый ответ по обращению №${ticket.id.slice(0, 8)}.`,
        importance: "high",
        ticketId: ticket.id,
      });
  });
  emit("support-queue");
  return messageId;
}
export function updateTicket(
  userId: string,
  ticketId: string,
  b: {
    action: string;
    reason?: string;
    assigneeId?: string;
    verification?: any;
  },
) {
  const actor = supportActor(userId),
    ticket =
      b.action === "assign"
        ? one("SELECT * FROM support_tickets WHERE id=?", ticketId)
        : ticketAccess(userId, ticketId, true);
  if (!ticket) throw new HttpError(404, "Обращение не найдено");
  if (
    b.action === "assign" &&
    actor.role !== "OWNER" &&
    ticket.assigned_to &&
    ticket.assigned_to !== userId
  )
    throw new HttpError(403, "Обращение уже назначено другому сотруднику");
  tx(() => {
    if (b.action === "assign") {
      const target = supportActor(b.assigneeId || userId);
      if (actor.role !== "OWNER" && target.id !== userId)
        throw new HttpError(
          403,
          "Назначать других сотрудников может владелец Orbit",
        );
      run(
        "UPDATE support_tickets SET assigned_to=?,updated_at=? WHERE id=?",
        target.id,
        now(),
        ticket.id,
      );
      audit(userId, "ticket.assigned", ticket.id, { assignee: target.id });
      return;
    }
    if (
      ["active", "waiting_user", "escalated"].includes(b.action) &&
      one(
        "SELECT 1 FROM support_tickets WHERE user_id=? AND id!=? AND status IN ('active','waiting_user','escalated')",
        ticket.user_id,
        ticket.id,
      )
    )
      throw new HttpError(
        409,
        "У пользователя уже есть активное обращение; оставьте это в очереди",
      );
    if (closedTicketStatuses.includes(ticket.status))
      throw new HttpError(409, "Обращение уже закрыто");
    if (
      ![
        "active",
        "waiting_user",
        "escalated",
        "accepted",
        "rejected",
        "closed",
      ].includes(b.action)
    )
      throw new HttpError(400, "Неизвестное состояние");
    if (
      ["waiting_user", "accepted", "rejected", "closed", "escalated"].includes(
        b.action,
      ) &&
      !b.reason?.trim()
    )
      throw new HttpError(400, "Напишите понятное объяснение пользователю");
    if (b.action === "accepted") {
      if (ticket.kind === "appeal")
        endDecision(userId, ticket.decision_id, b.reason!);
      if (["deletion", "deletion_proposal"].includes(ticket.kind))
        approveAccountDeletion(userId, ticket.user_id, b.reason!);
      if (ticket.kind === "verification") {
        if (!b.verification)
          throw new HttpError(
            400,
            "Выберите параметры подтверждения сообщества",
          );
        staffActor(userId, true);
        setVerification(userId, ticket.target_id, {
          ...b.verification,
          action: "grant",
          reason: b.reason!,
        });
      }
    }
    if (ticket.kind === "appeal" && b.action === "rejected") staffActor(userId);
    if (
      b.action === "active" &&
      ticket.status === "queued" &&
      one(
        "SELECT 1 FROM support_tickets WHERE user_id=? AND status IN ('active','waiting_user','escalated') AND id!=?",
        ticket.user_id,
        ticket.id,
      )
    )
      throw new HttpError(
        409,
        "У аккаунта уже рассматривается другое обращение",
      );
    run(
      "UPDATE support_tickets SET status=?,result=?,updated_at=? WHERE id=?",
      b.action,
      b.reason || null,
      now(),
      ticket.id,
    );
    if (b.reason)
      run(
        "INSERT INTO ticket_messages VALUES(?,?,'support',?,?,?)",
        id(),
        ticket.id,
        userId,
        b.reason,
        now(),
      );
    audit(userId, "ticket." + b.action, ticket.id, { reason: b.reason });
    deliverNotify(ticket.user_id, {
      key: `ticket-update:${ticket.id}:${id()}`,
      kind: "APPEAL_UPDATED",
      title: ticketStatusLabels[b.action] || "Обращение обновлено",
      body: b.reason || "Состояние обращения изменилось.",
      importance: "high",
      ticketId: ticket.id,
      decisionId: ticket.decision_id,
    });
    if (closedTicketStatuses.includes(b.action)) activateQueued(ticket.user_id);
  });
  emit("support-queue");
  emit();
}
export function activateQueued(userId: string) {
  if (
    one(
      "SELECT 1 FROM support_tickets WHERE user_id=? AND status IN ('active','waiting_user','escalated')",
      userId,
    )
  )
    return;
  const next = one(
    "SELECT id FROM support_tickets WHERE user_id=? AND status='queued' ORDER BY created_at,rowid LIMIT 1",
    userId,
  );
  if (!next) return;
  run(
    "UPDATE support_tickets SET status='active',updated_at=? WHERE id=?",
    now(),
    next.id,
  );
  deliverNotify(userId, {
    key: `ticket-activated:${next.id}`,
    kind: "APPEAL_UPDATED",
    title: "Началось рассмотрение обращения",
    body: `Обращение №${next.id.slice(0, 8)} перешло из очереди на рассмотрение.`,
    importance: "high",
    ticketId: next.id,
  });
}
