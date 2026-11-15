import { all, one, run, tx, id, now, audit } from "../database/index.js";
import { activeUser, HttpError, emit } from "../core.js";
import { deliverNotify } from "../notify/service.js";
import { suspendSpaceVerification } from "../governance/service.js";
export function requestTransfer(
  userId: string,
  spaceId: string,
  username: string,
) {
  activeUser(userId);
  const s = one("SELECT * FROM spaces WHERE id=? AND kind!='dm'", spaceId);
  if (!s || s.owner_id !== userId)
    throw new HttpError(403, "Передачу начинает владелец сообщества");
  if (s.delete_at || s.frozen)
    throw new HttpError(409, "Недоступное сообщество нельзя передать");
  const target = one(
    "SELECT * FROM users WHERE username=?",
    username.replace(/^@/, ""),
  );
  if (!target || target.status !== "active" || target.id === userId)
    throw new HttpError(400, "Выберите другой активный аккаунт");
  const existing = one(
    "SELECT * FROM ownership_transfers WHERE space_id=? AND status='pending'",
    s.id,
  );
  if (existing) {
    if (existing.to_id === target.id) return existing.id;
    throw new HttpError(409, "Уже ожидается подтверждение другой передачи");
  }
  const transferId = id();
  tx(() => {
    run(
      "INSERT INTO ownership_transfers(id,space_id,from_id,to_id,created_at,expires_at) VALUES(?,?,?,?,?,?)",
      transferId,
      s.id,
      userId,
      target.id,
      now(),
      now() + 86400000,
    );
    audit(userId, "ownership.requested", s.id, { to: target.id });
    deliverNotify(target.id, {
      key: `transfer:${transferId}`,
      kind: "OWNERSHIP_TRANSFER",
      title: "Вам предложено владение сообществом",
      body: `Вы можете принять «${s.title}» в течение суток. До принятия владелец остаётся прежним. Подтверждённый статус после передачи проверяется заново.`,
      importance: "high",
      objectType: "space",
      objectId: s.id,
      payload: { transferId, acceptTransfer: true },
    });
    deliverNotify(userId, {
      key: `transfer-pending:${transferId}`,
      kind: "OWNERSHIP_TRANSFER",
      title: "Предложение передачи отправлено",
      body: `«${s.title}»: ожидается подтверждение получателя.`,
      importance: "normal",
      objectType: "space",
      objectId: s.id,
      payload: { transferId, cancelTransfer: true },
    });
  });
  emit();
  return transferId;
}
export function resolveTransfer(
  userId: string,
  transferId: string,
  action: "accept" | "reject" | "cancel",
) {
  activeUser(userId);
  const t = one("SELECT * FROM ownership_transfers WHERE id=?", transferId);
  if (!t) throw new HttpError(404, "Передача не найдена");
  if (t.status !== "pending" || t.expires_at <= now())
    throw new HttpError(409, "Предложение уже завершено или срок истёк");
  if (
    (action === "cancel" && t.from_id !== userId) ||
    (action !== "cancel" && t.to_id !== userId)
  )
    throw new HttpError(403, "Вы не можете подтвердить эту передачу");
  const s = one("SELECT * FROM spaces WHERE id=?", t.space_id);
  if (!s || s.owner_id !== t.from_id || s.delete_at || s.frozen)
    throw new HttpError(
      409,
      "Состояние сообщества изменилось. Передача недоступна",
    );
  tx(() => {
    if (
      !run(
        "UPDATE ownership_transfers SET status=?,accepted_at=? WHERE id=? AND status='pending' AND expires_at>?",
        action === "accept"
          ? "accepted"
          : action === "reject"
            ? "rejected"
            : "cancelled",
        action === "accept" ? now() : null,
        t.id,
        now(),
      ).changes
    )
      throw new HttpError(409, "Передача уже обработана");
    if (action === "accept") {
      run(
        "UPDATE spaces SET owner_id=? WHERE id=? AND owner_id=?",
        t.to_id,
        s.id,
        t.from_id,
      );
      run(
        "UPDATE space_members SET role='member' WHERE space_id=? AND user_id=?",
        s.id,
        t.from_id,
      );
      run(
        "INSERT INTO space_members(space_id,user_id,role,can_publish,joined_at) VALUES(?,?,'admin',1,?) ON CONFLICT(space_id,user_id) DO UPDATE SET role='admin',can_publish=1",
        s.id,
        t.to_id,
        now(),
      );
      suspendSpaceVerification(
        s.id,
        "Смена владельца — необходима отдельная проверка",
        t.id,
        userId,
      );
    }
    audit(
      userId,
      action === "accept" ? "ownership.accepted" : "ownership.cancelled",
      s.id,
      { transferId: t.id },
    );
    for (const recipient of [t.to_id, t.from_id])
      deliverNotify(recipient, {
        key: `transfer-result:${t.id}`,
        kind: "OWNERSHIP_TRANSFER",
        title:
          action === "accept" ? "Владение передано" : "Передача не состоялась",
        body: `«${s.title}»: ${action === "accept" ? "получатель принял владение. Прежний владелец больше не имеет административных полномочий" : "предложение отменено или отклонено"}.`,
        importance: "high",
        objectType: "space",
        objectId: s.id,
      });
  });
  emit();
}
