import {
  removeUnusedOwnedMedia,
  collectMediaGarbage,
  queueUnusedMessageMedia,
} from "../media/garbage.js";
import {
  all,
  one,
  run,
  tx,
  id,
  now,
  audit,
  setting,
} from "../database/index.js";
import { HttpError, emit, io } from "../core.js";
import { deliverNotify } from "../notify/service.js";
import { reasonLabels } from "../../../../packages/shared/policy.js";

export function staffActor(actorId: string, ownerOnly = false) {
  const actor = one("SELECT * FROM users WHERE id=?", actorId);
  if (
    !actor ||
    actor.type !== "human" ||
    actor.status !== "active" ||
    (ownerOnly
      ? actor.role !== "OWNER"
      : !["OWNER", "ADMIN", "MODERATOR"].includes(actor.role))
  )
    throw new HttpError(
      403,
      ownerOnly
        ? "Действие доступно только владельцу Orbit"
        : "Недостаточно полномочий",
    );
  return actor;
}
export function recomputeBadges(eventKey: string) {
  const changed = all(
    `SELECT u.id,u.derived_verified,EXISTS(SELECT 1 FROM spaces s LEFT JOIN verification_categories c ON c.id=s.verification_category WHERE s.owner_id=u.id AND s.kind='channel' AND s.verified=1 AND s.verification_state='active' AND s.frozen=0 AND s.delete_at IS NULL AND (s.verification_type='orbit' OR c.derive_badge=1)) eligible FROM users u WHERE u.status='active' OR u.derived_verified!=0`,
  );
  for (const u of changed) {
    const value =
      u.eligible &&
      one("SELECT status FROM users WHERE id=?", u.id)?.status === "active"
        ? 1
        : 0;
    if (value === u.derived_verified) continue;
    run("UPDATE users SET derived_verified=? WHERE id=?", value, u.id);
    deliverNotify(u.id, {
      key: `badge:${eventKey}:${value}`,
      kind: value ? "DERIVED_BADGE_GRANTED" : "DERIVED_BADGE_REMOVED",
      title: value
        ? "Ваш профиль получил отметку"
        : "Отметка профиля больше не действует",
      body: value
        ? "Отметка присвоена автоматически по действующей верификации вашего канала. Публичный профиль не раскрывает, каким каналом вы владеете."
        : "Действующих оснований для автоматической отметки сейчас нет.",
      importance: "high",
    });
  }
}
function suspendVerification(
  space: any,
  reason: string,
  eventKey: string,
  actorId: string | null,
) {
  if (!space.verified && space.verification_state !== "active") return;
  const historyId = id();
  run(
    "UPDATE spaces SET verified=0,verification_state='suspended' WHERE id=?",
    space.id,
  );
  run(
    "INSERT INTO verification_history VALUES(?,?,?,?,?,?,?,?,?,?)",
    historyId,
    space.id,
    "suspend",
    space.verification_type,
    space.verification_category,
    space.funding_country,
    reason,
    "",
    actorId,
    now(),
  );
  deliverNotify(space.owner_id, {
    key: `verify-suspend:${eventKey}:${space.id}`,
    kind: "VERIFY_SUSPENDED",
    title: "Статус сообщества приостановлен",
    body: `«${space.title}»: ${reason}. После восстановления нужна отдельная проверка верификации.`,
    importance: "high",
    objectType: "space",
    objectId: space.id,
  });
}
export function syncSanctions(eventKey: string) {
  for (const d of all(
    "SELECT * FROM moderation_decisions WHERE target_type='user' AND action='freeze'",
  )) {
    const u = one("SELECT * FROM users WHERE id=?", d.target_id);
    if (!u) continue;
    if (d.active)
      for (const s of all(
        "SELECT * FROM spaces WHERE owner_id=? AND kind!='dm'",
        u.id,
      ))
        run(
          "INSERT OR IGNORE INTO moderation_decisions(id,target_type,target_id,action,reason_code,reason,actor_id,parent_id,active,starts_at,expires_at,public_reason) VALUES(?,'space',?,'freeze',?,?,?, ?,1,?,?,?)",
          `inherited:${d.id}:${s.id}`,
          s.id,
          d.reason_code,
          d.reason,
          d.actor_id,
          d.id,
          d.starts_at,
          d.expires_at,
          "Заморозка аккаунта владельца",
        );
    else
      run(
        "UPDATE moderation_decisions SET active=0,ended_at=?,end_reason=? WHERE parent_id=? AND active=1",
        now(),
        "Основная санкция завершена",
        d.id,
      );
  }
  for (const u of all(
    "SELECT * FROM users WHERE status='banned' OR id IN(SELECT target_id FROM moderation_decisions WHERE target_type='user')",
  )) {
    if (u.status === "deletion_pending") continue;
    const frozen = !!one(
      "SELECT 1 FROM moderation_decisions WHERE target_type='user' AND target_id=? AND active=1 AND action='freeze'",
      u.id,
    );
    const restricted = !!one(
      "SELECT 1 FROM moderation_decisions WHERE target_type='user' AND target_id=? AND active=1 AND action='restrict'",
      u.id,
    );
    const next = frozen
      ? "banned"
      : restricted
        ? "restricted"
        : ["banned", "restricted"].includes(u.status)
          ? "active"
          : u.status;
    if (u.status !== next) {
      run("UPDATE users SET status=?,presence_until=0 WHERE id=?", next, u.id);
      if (!frozen)
        deliverNotify(u.id, {
          key: `account:${eventKey}:${next}`,
          kind: "ACCOUNT_RESTORED",
          title: restricted
            ? "Полная заморозка снята, остаются ограничения"
            : "Доступ к аккаунту восстановлен",
          body: "Прежние чаты снова доступны в пределах текущих прав. Верификация сообществ проверяется отдельно.",
          importance: "critical",
          objectType: "user",
          objectId: u.id,
        });
      io?.to(`user:${u.id}`).emit("account-status", { status: next });
    }
    if (frozen)
      for (const m of all(
        "SELECT space_id FROM space_members WHERE user_id=?",
        u.id,
      ))
        io?.in(`user:${u.id}`).socketsLeave(`space:${m.space_id}`);
  }
  for (const s of all("SELECT * FROM spaces WHERE kind!='dm'")) {
    const frozen = one(
      "SELECT 1 FROM moderation_decisions WHERE target_type='space' AND target_id=? AND active=1 AND action='freeze'",
      s.id,
    )
      ? 1
      : 0;
    if (s.frozen !== frozen) {
      run("UPDATE spaces SET frozen=? WHERE id=?", frozen, s.id);
      deliverNotify(s.owner_id, {
        key: `space:${eventKey}:${s.id}:${frozen}`,
        kind: frozen ? "CHANNEL_FROZEN" : "CHANNEL_RESTORED",
        title: frozen ? "Сообщество заморожено" : "Сообщество восстановлено",
        body: `«${s.title}»: ${frozen ? "публикации и содержимое недоступны до снятия всех действующих оснований" : "заморозка снята. Верификация не восстанавливается автоматически"}.`,
        importance: "critical",
        objectType: "space",
        objectId: s.id,
      });
    }
    if (frozen) suspendVerification(s, "Действующая заморозка", eventKey, null);
  }
  recomputeBadges(eventKey);
  emit();
}
export function freezeTarget(
  actorId: string,
  targetType: "user" | "space",
  targetId: string,
  b: { reasonCode: string; reason: string; durationHours?: number | null },
) {
  const actor = staffActor(actorId);
  const target = one(
    `SELECT * FROM ${targetType === "user" ? "users" : "spaces"} WHERE id=?`,
    targetId,
  );
  if (!target) throw new HttpError(404, "Объект не найден");
  if (targetType === "space" && target.kind === "dm")
    throw new HttpError(400, "Личная переписка не является сообществом");
  if (
    targetType === "user" &&
    (target.role === "OWNER" ||
      (target.role !== "USER" && actor.role !== "OWNER"))
  )
    throw new HttpError(403, "Недостаточно прав для санкции этого аккаунта");
  if (!reasonLabels[b.reasonCode])
    throw new HttpError(400, "Выберите причину из списка");
  const existing = one(
    "SELECT id FROM moderation_decisions WHERE target_type=? AND target_id=? AND action='freeze' AND active=1 AND actor_id=? AND reason_code=? AND reason=? AND parent_id IS NULL",
    targetType,
    targetId,
    actorId,
    b.reasonCode,
    b.reason,
  );
  if (existing) return existing.id;
  const decisionId = id();
  tx(() => {
    run(
      "INSERT INTO moderation_decisions(id,target_type,target_id,action,reason_code,reason,actor_id,starts_at,expires_at,public_reason) VALUES(?,?,?,'freeze',?,?,?,?,?,?)",
      decisionId,
      targetType,
      targetId,
      b.reasonCode,
      b.reason,
      actorId,
      now(),
      b.durationHours ? now() + b.durationHours * 3600000 : null,
      reasonLabels[b.reasonCode],
    );
    audit(actorId, "moderation.freeze", targetId, {
      targetType,
      reason: b.reason,
      reasonCode: b.reasonCode,
      durationHours: b.durationHours || null,
      decisionId,
    });
    const recipient = targetType === "user" ? targetId : target.owner_id;
    deliverNotify(recipient, {
      key: `decision:${decisionId}`,
      kind: targetType === "user" ? "ACCOUNT_FROZEN" : "CHANNEL_FROZEN",
      title:
        targetType === "user"
          ? "Ваш аккаунт заморожен"
          : "Сообщество заморожено",
      body: `${targetType === "space" ? `«${target.title}». ` : ""}Причина: ${reasonLabels[b.reasonCode]}. ${b.reason}`,
      importance: "critical",
      objectType: targetType,
      objectId: targetId,
      decisionId,
      payload: {
        expiresAt: b.durationHours ? now() + b.durationHours * 3600000 : null,
      },
    });
    syncSanctions(decisionId);
  });
  return decisionId;
}
export function endDecision(
  actorId: string,
  decisionId: string,
  reason: string,
) {
  const actor = staffActor(actorId);
  const d = one("SELECT * FROM moderation_decisions WHERE id=?", decisionId);
  if (!d) throw new HttpError(404, "Решение не найдено");
  if (d.parent_id)
    throw new HttpError(
      409,
      "Это наследованная заморозка. Нужно отменить исходную санкцию аккаунта владельца.",
    );
  if (d.target_type === "user") {
    const target = one("SELECT role FROM users WHERE id=?", d.target_id);
    if (target && target.role !== "USER" && actor.role !== "OWNER")
      throw new HttpError(403, "Пересмотр доступен владельцу Orbit");
  }
  tx(() => {
    if (
      run(
        "UPDATE moderation_decisions SET active=0,ended_at=?,end_reason=? WHERE id=? AND active=1",
        now(),
        reason,
        decisionId,
      ).changes
    ) {
      audit(actorId, "moderation.restore", d.target_id, { decisionId, reason });
      syncSanctions(`end:${decisionId}`);
    }
  });
}
export function setVerification(
  actorId: string,
  spaceId: string,
  b: {
    action: "grant" | "revoke";
    type?: "standard" | "orbit";
    categoryId?: string;
    country?: string;
    reason: string;
    evidence?: string;
  },
) {
  staffActor(actorId, true);
  const s = one("SELECT * FROM spaces WHERE id=? AND kind!='dm'", spaceId);
  if (!s) throw new HttpError(404, "Сообщество не найдено");
  const type =
      b.action === "revoke" ? s.verification_type : b.type || "standard",
    category = one(
      "SELECT * FROM verification_categories WHERE id=?",
      b.action === "revoke"
        ? s.verification_category
        : b.categoryId || "blogger",
    );
  if (b.action === "grant") {
    if (s.frozen || s.delete_at)
      throw new HttpError(
        409,
        "Восстановите сообщество перед проверкой статуса",
      );
    if (
      one("SELECT status FROM users WHERE id=?", s.owner_id)?.status !==
      "active"
    )
      throw new HttpError(409, "Аккаунт владельца недоступен");
    if (type === "standard" && !category)
      throw new HttpError(400, "Категория не найдена");
    if (type === "standard" && category.requires_country) {
      const country = b.country || "";
      if (
        !/^[A-Z]{2}$/.test(country) ||
        country === "ZZ" ||
        new Intl.DisplayNames(["en"], { type: "region" }).of(country) ===
          country
      )
        throw new HttpError(400, "Выберите страну финансирования");
      if (!b.evidence?.trim())
        throw new HttpError(
          400,
          "Укажите основание сведений о финансировании СМИ",
        );
    }
  }
  const historyId = id();
  tx(() => {
    run(
      "UPDATE spaces SET verified=?,verification_type=?,verification_state=?,verification_category=?,funding_country=? WHERE id=?",
      b.action === "grant" ? 1 : 0,
      type,
      b.action === "grant" ? "active" : "revoked",
      type === "standard" ? category?.id : null,
      type === "standard" && category?.requires_country
        ? b.country || null
        : null,
      s.id,
    );
    run(
      "INSERT INTO verification_history VALUES(?,?,?,?,?,?,?,?,?,?)",
      historyId,
      s.id,
      b.action,
      type,
      category?.id || null,
      b.country || null,
      b.reason,
      b.evidence || "",
      actorId,
      now(),
    );
    audit(actorId, "verification." + b.action, s.id, {
      type,
      category: category?.name,
      reason: b.reason,
      historyId,
    });
    deliverNotify(s.owner_id, {
      key: `verification:${historyId}`,
      kind: b.action === "grant" ? "VERIFY_GRANTED" : "VERIFY_REVOKED",
      title:
        b.action === "grant"
          ? "Сообществу выдан статус"
          : "Статус сообщества отозван",
      body: `«${s.title}»: ${b.reason}`,
      importance: "high",
      objectType: "space",
      objectId: s.id,
      payload: { historyId },
    });
    recomputeBadges(historyId);
  });
  emit();
  return historyId;
}
export function requestChannelDeletion(userId: string, spaceId: string) {
  const s = one("SELECT * FROM spaces WHERE id=? AND kind!='dm'", spaceId);
  if (!s || s.owner_id !== userId)
    throw new HttpError(403, "Удаление запускает только владелец сообщества");
  if (s.delete_at) return s.delete_at;
  if (
    one(
      "SELECT 1 FROM ownership_transfers WHERE space_id=? AND status='pending'",
      spaceId,
    )
  )
    throw new HttpError(409, "Сначала отмените передачу владения");
  const delay = Math.max(
    30,
    Math.min(
      86400,
      setting("governance", { channelDeleteSeconds: 30 })
        .channelDeleteSeconds || 30,
    ),
  );
  const due = now() + delay * 1000;
  tx(() => {
    run(
      "UPDATE spaces SET delete_at=?,delete_requested_at=? WHERE id=?",
      due,
      now(),
      spaceId,
    );
    suspendVerification(
      s,
      "Владелец запустил удаление",
      `deleting:${due}`,
      userId,
    );
    recomputeBadges("deleting:" + spaceId + due);
    audit(userId, "channel.deletion_started", spaceId, {
      title: s.title,
      deleteAt: due,
    });
    deliverNotify(userId, {
      key: `channel-delete:${spaceId}:${due}`,
      kind: "CHANNEL_DELETION_STARTED",
      title: "Началось удаление сообщества",
      body: `«${s.title}» будет полностью удалено после окончания серверного отсчёта. До этого можно отменить удаление.`,
      importance: "critical",
      objectType: "space",
      objectId: spaceId,
      payload: { deleteAt: due },
    });
  });
  emit();
  return due;
}
export function suspendSpaceVerification(
  spaceId: string,
  reason: string,
  eventKey: string,
  actorId: string,
) {
  const s = one("SELECT * FROM spaces WHERE id=?", spaceId);
  if (s) suspendVerification(s, reason, eventKey, actorId);
  recomputeBadges(eventKey);
}
export function cancelChannelDeletion(userId: string, spaceId: string) {
  const s = one("SELECT * FROM spaces WHERE id=?", spaceId);
  if (!s || s.owner_id !== userId)
    throw new HttpError(403, "Отмена доступна только владельцу");
  if (
    !run(
      "UPDATE spaces SET delete_at=NULL,delete_requested_at=NULL WHERE id=? AND delete_at>?",
      spaceId,
      now(),
    ).changes
  )
    throw new HttpError(409, "Срок отмены уже истёк либо удаление не запущено");
  audit(userId, "channel.deletion_cancelled", spaceId, {});
  deliverNotify(userId, {
    key: `channel-delete-cancel:${spaceId}:${s.delete_at}`,
    kind: "CHANNEL_DELETION_CANCELLED",
    title: "Удаление отменено",
    body: `«${s.title}» сохранено. Статус верификации проверяется отдельно.`,
    importance: "high",
    objectType: "space",
    objectId: spaceId,
  });
  emit();
}
export function approveAccountDeletion(
  actorId: string,
  userId: string,
  reason: string,
) {
  staffActor(actorId, true);
  const u = one("SELECT * FROM users WHERE id=?", userId);
  if (!u) throw new HttpError(404, "Аккаунт не найден");
  if (u.role === "OWNER")
    throw new HttpError(
      403,
      "Единственный владелец Orbit не может удалить свой аккаунт",
    );
  const blockers = all(
    "SELECT id,title,kind FROM spaces WHERE owner_id=? AND kind!='dm'",
    userId,
  );
  if (blockers.length)
    throw new HttpError(
      409,
      "Передайте или удалите принадлежащие сообщества: " +
        blockers.map((s) => s.title).join(", "),
      "OWNED_COMMUNITIES",
    );
  if (u.deletion_at) return u.deletion_at;
  const due = now() + 3600000;
  tx(() => {
    run(
      "UPDATE users SET deletion_at=?,deletion_previous_status=status,status='deletion_pending',presence_until=0,derived_verified=0 WHERE id=?",
      due,
      userId,
    );
    audit(actorId, "account.deletion_approved", userId, {
      reason,
      deleteAt: due,
    });
    deliverNotify(userId, {
      key: `account-delete:${due}`,
      kind: "ACCOUNT_DELETION_SCHEDULED",
      title: "Удаление аккаунта подтверждено",
      body: "Аккаунт удаляется по запросу через поддержку. В течение часа вы можете отменить удаление здесь, в Notify. После срока исчезнут личные чаты и ваши сообщения.",
      importance: "critical",
      objectType: "user",
      objectId: userId,
      payload: { deleteAt: due },
    });
  });
  for (const m of all(
    "SELECT space_id FROM space_members WHERE user_id=?",
    userId,
  ))
    io?.in("user:" + userId).socketsLeave("space:" + m.space_id);
  io?.to(`user:${userId}`).emit("account-status", {
    status: "deletion_pending",
  });
  emit();
  return due;
}
export function cancelAccountDeletion(userId: string) {
  const u = one("SELECT * FROM users WHERE id=?", userId);
  if (!u?.deletion_at || u.deletion_at <= now())
    throw new HttpError(409, "Срок отмены истёк либо удаление не запущено");
  tx(() => {
    const status = one(
      "SELECT 1 FROM moderation_decisions WHERE target_type='user' AND target_id=? AND active=1 AND action='freeze'",
      userId,
    )
      ? "banned"
      : one(
            "SELECT 1 FROM moderation_decisions WHERE target_type='user' AND target_id=? AND active=1 AND action='restrict'",
            userId,
          )
        ? "restricted"
        : "active";
    run(
      "UPDATE users SET deletion_at=NULL,deletion_previous_status=NULL,status=? WHERE id=?",
      status,
      userId,
    );
    audit(userId, "account.deletion_cancelled", userId, {});
    deliverNotify(userId, {
      key: `account-delete-cancel:${u.deletion_at}`,
      kind: "ACCOUNT_DELETION_CANCELLED",
      title: "Удаление аккаунта отменено",
      body: "Ваши данные сохранены. Остальные действующие ограничения, если они есть, продолжают действовать.",
      importance: "critical",
    });
    recomputeBadges("account-delete-cancel:" + u.deletion_at);
  });
  io?.to(`user:${userId}`).emit("account-status", {});
  emit();
}
function detachMessages(where: string, args: any[]) {
  const rows = all(`SELECT id FROM messages WHERE ${where}`, ...args);
  for (const m of rows) {
    run("UPDATE messages SET reply_to=NULL WHERE reply_to=?", m.id);
    run("UPDATE messages SET forwarded_from=NULL WHERE forwarded_from=?", m.id);
  }
  return rows;
}
function purgeSpace(s: any) {
  const files = all(
    "SELECT mm.media_id id FROM message_media mm JOIN messages m ON m.id=mm.message_id WHERE m.space_id=?",
    s.id,
  ).map((m) => m.id);
  if (s.avatar?.startsWith("/media/")) files.push(s.avatar.slice(7));
  const messages = detachMessages("space_id=?", [s.id]);
  for (const m of messages) {
    run(
      "DELETE FROM ban_appeals WHERE topic_id IN(SELECT id FROM forum_topics WHERE id=? AND category='comments')",
      m.id,
    );
    run(
      "DELETE FROM forum_replies WHERE topic_id IN(SELECT id FROM forum_topics WHERE id=? AND category='comments')",
      m.id,
    );
    run("DELETE FROM forum_topics WHERE id=? AND category='comments'", m.id);
  }
  run("DELETE FROM notifications WHERE target=?", s.id);
  run(
    "UPDATE ai_jobs SET status='cancelled',error='Сообщество удалено' WHERE status='queued' AND json_extract(payload,'$.spaceId')=?",
    s.id,
  );
  run("DELETE FROM spaces WHERE id=?", s.id);
  queueUnusedMessageMedia(files);
  emit("space-removed", { spaceId: s.id });
  audit(null, "channel.deleted", s.id, { title: s.title });
  deliverNotify(s.owner_id, {
    key: `channel-deleted:${s.id}`,
    kind: "CHANNEL_DELETED",
    title: "Сообщество удалено владельцем",
    body: `«${s.title}» удалено. Самостоятельные пересланные копии остаются у получателей без ссылки на источник.`,
    importance: "critical",
  });
}
function purgeAccount(u: any) {
  if (one("SELECT 1 FROM spaces WHERE owner_id=? AND kind!='dm'", u.id))
    throw new Error("Deletion invariant: account still owns a community");
  for (const s of all(
    "SELECT s.* FROM spaces s JOIN space_members m ON m.space_id=s.id WHERE m.user_id=? AND s.kind='dm'",
    u.id,
  ))
    purgeSpace(s);
  run(
    "DELETE FROM notifications WHERE kind='message' AND target IN(SELECT space_id FROM messages WHERE sender_id=?)",
    u.id,
  );
  const affected = all(
    "SELECT DISTINCT user_id FROM agent_memories WHERE target_id=? OR source_id IN(SELECT id FROM messages WHERE sender_id=?)",
    u.id,
    u.id,
  );
  for (const a of affected)
    run("UPDATE ai_personas SET summary='' WHERE user_id=?", a.user_id);
  run(
    "DELETE FROM agent_memories WHERE target_id=? OR source_id IN(SELECT id FROM messages WHERE sender_id=?)",
    u.id,
    u.id,
  );
  detachMessages("sender_id=?", [u.id]);
  run("DELETE FROM messages WHERE sender_id=?", u.id);
  run(
    "DELETE FROM ban_appeals WHERE user_id=? OR action_id IN(SELECT id FROM moderation_actions WHERE target_id=?)",
    u.id,
    u.id,
  );
  run(
    "DELETE FROM forum_replies WHERE author_id=? OR topic_id IN(SELECT id FROM forum_topics WHERE author_id=?)",
    u.id,
    u.id,
  );
  run("DELETE FROM forum_topics WHERE author_id=?", u.id);
  run("UPDATE moderation_actions SET actor_id=NULL WHERE actor_id=?", u.id);
  run("DELETE FROM moderation_actions WHERE target_id=?", u.id);
  run("DELETE FROM reports WHERE reporter_id=?", u.id);

  run("DELETE FROM scheduled_posts WHERE author_id=?", u.id);
  removeUnusedOwnedMedia(u.id);
  run("DELETE FROM channel_comments WHERE author_id=?", u.id);
  run(
    "DELETE FROM moderation_decisions WHERE target_type='user' AND target_id=?",
    u.id,
  );
  run("DELETE FROM reports WHERE target_type='user' AND target_id=?", u.id);
  run("DELETE FROM notifications WHERE target=?", u.id);
  run(
    "UPDATE audit_logs SET actor_id=NULL,target=NULL,detail='{}' WHERE actor_id=? OR target=?",
    u.id,
    u.id,
  );
  run("DELETE FROM users WHERE id=?", u.id);
  audit(null, "account.deleted", u.id, {
    reason: "Истёк подтверждённый срок удаления",
  });
}
let maintenanceRunning = false;
export function maintainGovernance(at = now()) {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    tx(() => {
      const expired = all(
        "SELECT * FROM moderation_decisions WHERE active=1 AND expires_at IS NOT NULL AND expires_at<=?",
        at,
      );
      for (const d of expired) {
        run(
          "UPDATE moderation_decisions SET active=0,ended_at=?,end_reason='Истёк срок' WHERE id=?",
          at,
          d.id,
        );
        audit(null, "moderation.expired", d.target_id, { decisionId: d.id });
      }
      if (expired.length)
        syncSanctions("expired:" + expired.map((d) => d.id).join(":"));
      run(
        "UPDATE ownership_transfers SET status='expired' WHERE status='pending' AND expires_at<=?",
        at,
      );
      const spaces = all(
        "SELECT * FROM spaces WHERE delete_at IS NOT NULL AND delete_at<=?",
        at,
      );
      for (const s of spaces) purgeSpace(s);
      const users = all(
        "SELECT * FROM users WHERE deletion_at IS NOT NULL AND deletion_at<=?",
        at,
      );
      for (const u of users) purgeAccount(u);
      if (spaces.length || users.length) {
        recomputeBadges("purge:" + at);
        emit();
      }
    });
    collectMediaGarbage();
  } finally {
    maintenanceRunning = false;
  }
}
export function statusSummary(type: "user" | "space", targetId: string) {
  const target = one(
    `SELECT * FROM ${type === "user" ? "users" : "spaces"} WHERE id=?`,
    targetId,
  );
  if (!target) throw new HttpError(404, "Объект не найден");
  const decisions = all(
    "SELECT id,public_reason,expires_at FROM moderation_decisions WHERE target_type=? AND target_id=? AND active=1 AND action='freeze'",
    type,
    targetId,
  );
  const category =
    target.verification_category &&
    one(
      "SELECT name,style FROM verification_categories WHERE id=?",
      target.verification_category,
    );
  return {
    targetType: type,
    targetId,
    frozen: decisions.length > 0,
    reason: [...new Set(decisions.map((d) => d.public_reason))].join("; "),
    expiresAt: decisions.some((d) => !d.expires_at)
      ? null
      : Math.max(0, ...decisions.map((d) => d.expires_at)),
    deleteAt: type === "user" ? target.deletion_at : target.delete_at,
    verification:
      type === "space"
        ? {
            active: !!target.verified,
            type: target.verification_type,
            category: category?.name,
            style: category?.style,
            country: target.funding_country,
          }
        : { active: !!target.derived_verified, type: "derived" },
    serverNow: now(),
  };
}
