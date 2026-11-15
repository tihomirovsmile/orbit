import { deliverNotify } from "./notify/service.js";
import { reservedIdentity } from "../../../packages/shared/policy.js";
import type { FastifyRequest } from "fastify";
import type { Server } from "socket.io";
import { all, one, run, id, now, audit, setting } from "./database/index.js";
export let io: Server | undefined;
export function setIO(server: Server) {
  io = server;
}
export function emit(event = "refresh", data: any = {}) {
  io?.emit(event, data);
}
export class HttpError extends Error {
  public code?: string;
  public retryAfterMs?: number;
  constructor(
    public statusCode: number,
    message: string,
    code?: string,
  ) {
    super(message);
    this.code = code;
  }
}
export function requireUser(req: FastifyRequest, allowBanned = false) {
  const token = req.cookies?.session;
  const session =
    token &&
    one(
      "SELECT s.*,u.status,u.role,u.type,u.permissions FROM sessions s JOIN users u ON u.id=s.user_id WHERE token=? AND expires_at>?",
      token,
      now(),
    );
  if (!session) throw new HttpError(401, "Требуется вход");
  if (!allowBanned && ["banned", "deletion_pending"].includes(session.status))
    throw new HttpError(
      403,
      "Обычные функции недоступны. Откройте Notify для информации и обращения в поддержку.",
      "ACCOUNT_LIMITED",
    );
  return session;
}
export function requireAdmin(req: FastifyRequest) {
  const s = requireUser(req);
  if (s.type !== "human" || !["OWNER", "ADMIN", "MODERATOR"].includes(s.role))
    throw new HttpError(403, "Требуются права администратора");
  return s;
}
export function requireOwner(req: FastifyRequest) {
  const s = requireUser(req);
  if (s.type !== "human" || s.role !== "OWNER")
    throw new HttpError(403, "Требуются права владельца");
  return s;
}
export function requireAiManager(req: FastifyRequest) {
  const s = requireUser(req);
  if (
    s.type !== "human" ||
    !(
      s.role === "OWNER" ||
      (s.role === "ADMIN" && JSON.parse(s.permissions || "{}").manageAi)
    )
  )
    throw new HttpError(403, "Владелец не назначил вам управление моделями");
  return s;
}
export function requirePersonaCreator(req: FastifyRequest) {
  const s = requireUser(req);
  if (
    s.type !== "human" ||
    !(
      s.role === "OWNER" ||
      (s.role === "ADMIN" && JSON.parse(s.permissions || "{}").createPersonas)
    )
  )
    throw new HttpError(403, "Недостаточно полномочий для создания личности");
  return s;
}
export function activeUser(userId: string) {
  const u = one("SELECT * FROM users WHERE id=?", userId);
  if (!u || ["banned", "deletion_pending"].includes(u.status))
    throw new HttpError(403, "Аккаунт недоступен");
  return u;
}
export function member(
  userId: string,
  spaceId: string,
  write = false,
  operation = "publish",
) {
  activeUser(userId);
  const space = one("SELECT * FROM spaces WHERE id=?", spaceId);
  if (!space) throw new HttpError(404, "Пространство не найдено");
  const m = one(
    "SELECT * FROM space_members WHERE user_id=? AND space_id=?",
    userId,
    spaceId,
  );
  if (!m && (space.visibility === "private" || space.kind === "dm" || write))
    throw new HttpError(403, "Нет доступа к переписке");
  if (space.frozen || space.delete_at) {
    const user = one("SELECT role FROM users WHERE id=?", userId);
    if (
      !write &&
      (space.owner_id === userId ||
        m?.role === "admin" ||
        ["OWNER", "ADMIN", "MODERATOR"].includes(user?.role))
    )
      return { ...space, member: m, contentUnavailable: true };
    throw new HttpError(
      423,
      space.delete_at ? "Сообщество ожидает удаления" : "Сообщество заморожено",
      "SPACE_UNAVAILABLE",
    );
  }
  if (write) {
    const u = activeUser(userId);
    if (u.status === "restricted")
      throw new HttpError(403, "Отправка ограничена");
    if (space.frozen) throw new HttpError(403, "Публикации приостановлены");
    if (
      space.kind === "channel" &&
      m?.role !== "admin" &&
      space.owner_id !== userId
    )
      throw new HttpError(
        403,
        "Публиковать могут только администраторы канала",
      );
    if (
      space.kind === "channel" &&
      space.owner_id !== userId &&
      ((operation === "publish" && !m?.can_publish) ||
        JSON.parse(m?.permissions || "{}")[operation] === false)
    )
      throw new HttpError(403, "У вас нет права публикации в канале");
  }
  return { ...space, member: m };
}
export function spacePermission(
  userId: string,
  space: any,
  permission: string,
) {
  if (space.owner_id === userId) return;
  if (
    space.member?.role !== "admin" ||
    !JSON.parse(space.member.permissions || "{}")[permission]
  )
    throw new HttpError(
      403,
      "У вас нет полномочия: " +
        (
          {
            settings: "настройки",
            members: "участники",
            admins: "администраторы",
            edit: "редактирование",
            delete: "удаление",
          } as any
        )[permission],
    );
}
export function notify(
  userId: string,
  kind: string,
  text: string,
  target?: string,
) {
  if (["provider", "budget"].includes(kind)) {
    deliverNotify(userId, {
      key:
        kind +
        ":" +
        new Date().toISOString().slice(0, 10) +
        ":" +
        text.slice(0, 80),
      kind: kind === "budget" ? "BUDGET_LIMIT" : "PROVIDER_FAILURE",
      title:
        kind === "budget"
          ? "Лимит расходов ИИ"
          : "Подключение ИИ требует внимания",
      body: text,
      importance: "high",
      objectId: target,
    });
  }
  const muted =
    target &&
    one(
      "SELECT muted FROM space_members WHERE space_id=? AND user_id=?",
      target,
      userId,
    )?.muted;
  if (muted) return;
  run(
    "INSERT INTO notifications VALUES(?,?,?,?,?,NULL,?)",
    id(),
    userId,
    kind,
    text,
    target || null,
    now(),
  );
  io?.to(`user:${userId}`).emit("notification", { kind, text, target });
}
export function activity(userId: string, action: string, detail: string) {
  run(
    "INSERT INTO agent_activity_logs VALUES(?,?,?,?,?)",
    id(),
    userId,
    action,
    detail,
    now(),
  );
  emit("activity");
}
export function isBlocked(a: string, b: string) {
  return !!one(
    "SELECT 1 FROM blocks WHERE (user_id=? AND target_id=?) OR (user_id=? AND target_id=?)",
    a,
    b,
    b,
    a,
  );
}
export function createSpace(
  userId: string,
  input: {
    kind: string;
    title: string;
    description?: string;
    visibility?: string;
    slug?: string;
    members?: string[];
    rules?: string;
  },
) {
  activeUser(userId);
  if (reservedIdentity(input.title) || reservedIdentity(input.slug || ""))
    throw new HttpError(400, "Имя Notify зарезервировано системой");
  const policy = setting("governance", {
      maxCommunitiesHuman: 100,
      maxCommunitiesAi: 6,
    }),
    isAi = one("SELECT type FROM users WHERE id=?", userId)?.type === "ai";
  if (
    input.kind !== "dm" &&
    one(
      "SELECT count(*) n FROM spaces WHERE owner_id=? AND kind!='dm'",
      userId,
    )!.n >=
      (isAi
        ? (policy.maxCommunitiesAi ?? 6)
        : (policy.maxCommunitiesHuman ?? 100))
  )
    throw new HttpError(409, "Достигнут лимит принадлежащих сообществ");
  if (input.kind === "dm") {
    const peers = [...new Set(input.members || [])].filter(
      (uid) => uid !== userId,
    );
    if (peers.length !== 1)
      throw new HttpError(400, "Личная переписка требует одного собеседника");
    const target = activeUser(peers[0]);
    if (isBlocked(userId, target.id))
      throw new HttpError(403, "Общение заблокировано");
    if (
      target.privacy === "contacts" &&
      !one(
        "SELECT 1 FROM follows WHERE follower_id=? AND target_id=?",
        target.id,
        userId,
      )
    )
      throw new HttpError(
        403,
        "Собеседник принимает сообщения только от контактов",
      );
  }
  const spaceId = id();
  const time = now();
  const slug = input.slug || `space-${spaceId.slice(0, 8)}`;
  run(
    "INSERT INTO spaces(id,kind,title,slug,description,visibility,owner_id,invite,rules,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    spaceId,
    input.kind,
    input.title,
    slug,
    input.description || "",
    input.kind === "dm" ? "private" : input.visibility || "public",
    userId,
    id(),
    input.rules || "",
    time,
  );
  for (const uid of new Set([userId, ...(input.members || [])])) {
    activeUser(uid);
    run(
      "INSERT INTO space_members(space_id,user_id,role,joined_at) VALUES(?,?,?,?)",
      spaceId,
      uid,
      uid === userId ? "admin" : "member",
      time,
    );
    if (uid !== userId) notify(uid, "invitation", input.title, spaceId);
  }
  return spaceId;
}
