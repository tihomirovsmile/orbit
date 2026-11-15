import { all, one, run, tx, id, now, audit } from "../database/index.js";
import { activeUser, member, HttpError, emit } from "../core.js";
import { reasonLabels } from "../../../../packages/shared/policy.js";
import { deliverNotify } from "../notify/service.js";
export function createReport(
  userId: string,
  b: {
    targetId: string;
    targetType?: string;
    reasonCode?: string;
    comment?: string;
    reason?: string;
    evidenceMessageId?: string;
  },
) {
  activeUser(userId);
  let targetId = b.targetId,
    targetType = b.targetType;
  const message = one(
    "SELECT * FROM messages WHERE id=? AND deleted_at IS NULL",
    targetId,
  );
  if (message) {
    const space = member(userId, message.space_id);
    targetId = space.kind === "channel" ? space.id : message.sender_id;
    targetType = space.kind === "channel" ? "space" : "user";
  }
  const u = one("SELECT id FROM users WHERE id=?", targetId),
    space = one("SELECT * FROM spaces WHERE id=? AND kind!='dm'", targetId);
  if (!u && !space) throw new HttpError(404, "Объект жалобы не найден");
  targetType = space ? "space" : "user";
  if (targetId === userId || space?.owner_id === userId)
    throw new HttpError(
      400,
      "Нельзя жаловаться на самого себя или своё сообщество",
    );
  if (space) member(userId, space.id);
  if (b.evidenceMessageId) {
    const evidence = one(
      "SELECT space_id,sender_id FROM messages WHERE id=? AND deleted_at IS NULL",
      b.evidenceMessageId,
    );
    if (!evidence)
      throw new HttpError(404, "Сообщение-доказательство не найдено");
    member(userId, evidence.space_id);
    if (
      targetType === "space"
        ? evidence.space_id !== targetId
        : evidence.sender_id !== targetId
    )
      throw new HttpError(400, "Доказательство относится к другому объекту");
  }
  const reasonCode = b.reasonCode || "other";
  if (!reasonLabels[reasonCode])
    throw new HttpError(400, "Выберите причину жалобы");
  const existing = one(
    "SELECT id FROM reports WHERE reporter_id=? AND target_id=? AND reason_code=? AND status IN ('open','reviewing','deferred')",
    userId,
    targetId,
    reasonCode,
  );
  if (existing) return existing.id;
  const reportId = id(),
    comment = (b.comment || b.reason || "").trim();
  tx(() => {
    run(
      "INSERT INTO reports(id,reporter_id,target_id,reason,status,created_at,reason_code,comment,target_type) VALUES(?,?,?,?,'open',?,?,?,?)",
      reportId,
      userId,
      targetId,
      reasonLabels[reasonCode] + (comment ? ": " + comment : ""),
      now(),
      reasonCode,
      comment,
      targetType,
    );
    run(
      "UPDATE reports SET evidence_message_id=? WHERE id=?",
      b.evidenceMessageId || message?.id || null,
      reportId,
    );
    audit(userId, "report.created", targetId, {
      reportId,
      targetType,
      reasonCode,
      evidenceMessageId: b.evidenceMessageId || message?.id,
    });
    for (const owner of all("SELECT id FROM users WHERE role='OWNER'"))
      deliverNotify(owner.id, {
        key: `report:${reportId}`,
        kind: "REPORT_SUBMITTED",
        title: "Новая жалоба",
        body: "Жалоба добавлена в общую очередь ручной проверки. Сам факт подачи не применяет санкцию.",
        importance: "normal",
        objectType: targetType,
        objectId: targetId,
        payload: { reportId },
      });
  });
  emit("support-queue");
  return reportId;
}
