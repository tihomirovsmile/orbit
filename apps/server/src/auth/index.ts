import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "../database/schema.js";
import {
  orm,
  one,
  run,
  tx,
  id,
  now,
  publicUser,
  setting,
  setSetting,
  audit,
} from "../database/index.js";
import { HttpError, requireUser } from "../core.js";
import { ensureNotify } from "../notify/service.js";
import { reservedIdentity } from "../../../../packages/shared/policy.js";
const registration = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_\.]{3,32}$/),
  displayName: z.string().trim().min(1).max(60),
  password: z.string().min(10).max(200),
  language: z.enum(["ru", "uk", "en", "it", "es"]).default("ru"),
});
export function sessionFor(userId: string) {
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  run(
    "INSERT INTO sessions VALUES(?,?,?,?)",
    token,
    userId,
    csrf,
    now() + 30 * 86400000,
  );
  return { token, csrf };
}
export async function authRoutes(app: FastifyInstance) {
  app.get("/api/bootstrap", async (req) => {
    let user = null,
      csrf = null;
    try {
      const s = requireUser(req, true);
      user = publicUser(
        one("SELECT * FROM users WHERE id=?", s.user_id),
        s.user_id,
      );
      csrf = s.csrf;
    } catch {}
    return {
      needsSetup:
        !setting("setupClosed", false) && !one("SELECT id FROM users LIMIT 1"),
      user,
      csrf,
      network: setting("network", {
        name: "Orbit",
        description: "A space for unexpected connections",
        language: "ru",
        registration: true,
        timezone: "Europe/Kyiv",
        access: "localhost",
      }),
      simulation: setting("simulation", {
        status: "stopped",
        mode: "live",
        speed: 1,
        target: 10,
        activity: 0.4,
      }),
    };
  });
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = registration.parse(req.body);
      if (reservedIdentity(body.username) || reservedIdentity(body.displayName))
        throw new HttpError(400, "Имя Notify зарезервировано системой");
      const passwordHash = await argon2.hash(body.password, {
        type: argon2.argon2id,
      });
      const userId = id();
      tx(() => {
        const first =
          !one("SELECT id FROM users LIMIT 1") &&
          !setting("setupClosed", false);
        const network = setting("network", {
          registration: true,
          maxHumans: 0,
        });
        if (!first && !network.registration)
          throw new HttpError(403, "Регистрация закрыта");
        if (
          !first &&
          network.maxHumans > 0 &&
          one("SELECT count(*) n FROM users WHERE type='human'")!.n >=
            network.maxHumans
        )
          throw new HttpError(403, "Достигнут лимит пользователей");
        orm
          .insert(users)
          .values({
            id: userId,
            username: body.username,
            displayName: body.displayName,
            passwordHash,
            type: "human",
            role: first ? "OWNER" : "USER",
            language: body.language,
            createdAt: now(),
            lastSeen: now(),
          })
          .run();
        if (first) setSetting("setupClosed", true);
        audit(userId, "register", userId);
        ensureNotify(userId);
      });
      const session = sessionFor(userId);
      reply.setCookie("session", session.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.SECURE_COOKIE === "true",
        path: "/",
      });
      return {
        user: publicUser(one("SELECT * FROM users WHERE id=?", userId)),
        csrf: session.csrf,
      };
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z
        .object({
          username: z.string().max(100),
          password: z.string().max(200),
        })
        .parse(req.body);
      const u = orm
        .select()
        .from(users)
        .where(eq(users.username, body.username))
        .get();
      if (
        !u?.passwordHash ||
        !(await argon2.verify(u.passwordHash, body.password))
      )
        throw new HttpError(401, "Неверный логин или пароль");
      const s = sessionFor(u.id);
      reply.setCookie("session", s.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.SECURE_COOKIE === "true",
        path: "/",
      });
      run("UPDATE users SET last_seen=? WHERE id=?", now(), u.id);
      return {
        user: publicUser(one("SELECT * FROM users WHERE id=?", u.id)),
        csrf: s.csrf,
      };
    },
  );
  app.post("/api/auth/logout", async (req, reply) => {
    const s = requireUser(req, true);
    run("DELETE FROM sessions WHERE token=?", s.token);
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });
}
