import { all, one } from "../database/index.js";
import {
  reasonLabels,
  ticketStatusLabels,
} from "../../../../packages/shared/policy.js";
const verbs: Record<string, string> = {
  register: "создал аккаунт",
  "moderation.freeze": "заморозил",
  "moderation.restore": "снял санкцию с",
  "moderation.expired": "завершила временную санкцию для",
  "moderation.warn": "предупредил",
  "moderation.restrict": "ограничил отправку для",
  "verification.grant": "выдал статус сообществу",
  "verification.revoke": "отозвал статус сообщества",
  "channel.deletion_started": "запустил удаление сообщества",
  "channel.deletion_cancelled": "отменил удаление сообщества",
  "channel.deleted": "удалила сообщество после истечения срока",
  "account.deletion_approved": "подтвердил удаление аккаунта через час",
  "account.deletion_cancelled": "отменил удаление аккаунта",
  "account.deleted": "завершила удаление аккаунта",
  "ticket.created": "создал обращение",
  "ticket.assigned": "назначил исполнителя обращения",
  "ticket.support_reply": "ответил в обращении",
  "ticket.user_reply": "дополнил обращение",
  "ticket.withdrawn": "отозвал обращение",
  "provider.save": "обновил подключение ИИ",
  "model.assign": "назначил модель ИИ",
  "ai.unified-model": "назначил единую модель для всех задач",
  "ai.recover": "восстановил очередь ИИ",
  "agent.update": "изменил личность",
  "space.configure": "изменил настройки сообщества",
  "ownership.requested": "предложил передачу сообщества",
  "ownership.accepted": "принял владение сообществом",
  "role.changed": "изменил полномочия аккаунта",
  "report.created": "подал жалобу",
  "report.deferred": "отложил жалобу",
  "report.resolved": "рассмотрел жалобу",
};
function redact(value: any): any {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        /key|secret|password|authorization/i.test(key) ? "[скрыто]" : redact(v),
      ]),
    );
  return value;
}
export function readableAudit(rows: any[]) {
  return rows.map((row) => {
    let detail: any = {};
    try {
      detail = JSON.parse(row.detail || "{}");
    } catch {
      detail = { description: row.detail };
    }
    detail = redact(detail);
    const actor = row.actor_id
      ? row.actorName ||
        one("SELECT display_name FROM users WHERE id=?", row.actor_id)
          ?.display_name ||
        "Удалённый сотрудник"
      : "Система";
    const target =
      one("SELECT title FROM spaces WHERE id=?", row.target)?.title ||
      one("SELECT display_name FROM users WHERE id=?", row.target)
        ?.display_name ||
      detail.title ||
      (row.action.startsWith("ticket.")
        ? "№" + String(row.target).slice(0, 8)
        : row.target || "настройки платформы");
    const verb =
      verbs[row.action] ||
      (row.action.startsWith("ticket.")
        ? `изменил состояние обращения на «${ticketStatusLabels[row.action.slice(7)] || row.action.slice(7)}»`
        : row.action.startsWith("user.")
          ? "выполнил действие над аккаунтом"
          : row.action.startsWith("space.admin.")
            ? "изменил администратора сообщества"
            : "изменил данные");
    const reason = detail.reason || reasonLabels[detail.reasonCode] || "";
    return {
      id: row.id,
      createdAt: row.created_at,
      actor,
      target,
      action: row.action,
      summary: `${actor} ${verb} «${target}».${reason ? " Причина: " + reason : ""}`,
      reason,
      technical: {
        actorId: row.actor_id,
        targetId: row.target,
        action: row.action,
        detail,
      },
    };
  });
}
