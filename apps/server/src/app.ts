import { desktopRoutes } from "./desktop.js";
import { policyRoutes } from "./admin/policies.js";
import { evaluationRoutes } from "./admin/evaluations.js";
import { personaRoutes } from "./admin/personas.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { existsSync } from "node:fs";
import { Server } from "socket.io";
import { ZodError, z } from "zod";
z.config(z.locales.ru());
import { one, now, run } from "./database/index.js";
import { setIO, member } from "./core.js";
import { authRoutes } from "./auth/index.js";
import { messagingRoutes } from "./messages/routes.js";
import { userRoutes } from "./users/index.js";
import { forumRoutes } from "./forum/index.js";
import { mediaRoutes } from "./media/index.js";
import { adminRoutes } from "./admin/index.js";
import { providerRoutes } from "./ai/providers/routes.js";
import { avatarRoutes } from "./media/avatars.js";
import { managementRoutes } from "./messages/management.js";
import { aiSetupRoutes } from "./admin/ai-setup.js";
import { metricsRoutes } from "./admin/metrics.js";
import { notifyRoutes } from "./notify/routes.js";
import { initializeNotify, setNotifyPublisher } from "./notify/service.js";
import { maintainGovernance, syncSanctions } from "./governance/service.js";
import { governanceRoutes } from "./governance/routes.js";
import { ownershipRoutes } from "./messages/ownership-routes.js";
export async function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    bodyLimit: 1048576,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  await app.register(multipart, {
    limits: { fileSize: 800 * 1024 * 1024, files: 1, fields: 5 },
  });
  app.addHook("onRequest", async (req, reply) => {
    const pathname = req.url.split("?")[0];
    const account =
      req.cookies.session &&
      one(
        "SELECT u.status FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?",
        req.cookies.session,
        now(),
      );
    if (
      account &&
      ["banned", "deletion_pending"].includes(account.status) &&
      pathname.startsWith("/api/") &&
      !pathname.startsWith("/api/notify") &&
      ![
        "/api/bootstrap",
        "/api/auth/logout",
        "/api/auth/login",
        "/api/health",
      ].includes(pathname) &&
      !(req.method === "GET" && pathname === "/api/spaces")
    )
      return reply.code(403).send({
        error:
          "Доступен только Notify: причины ограничения и обращения в поддержку.",
        code: "ACCOUNT_LIMITED",
      });
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = process.env.PUBLIC_ORIGIN;
      if (
        origin &&
        origin !== allowed &&
        origin !== `http://${req.headers.host}` &&
        !(
          process.env.NODE_ENV !== "production" &&
          /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin)
        )
      )
        return reply.code(403).send({ error: "Недопустимый Origin" });
      if (req.cookies.session) {
        const s = one(
          "SELECT csrf FROM sessions WHERE token=? AND expires_at>?",
          req.cookies.session,
          now(),
        );
        if (s && req.headers["x-csrf-token"] !== s.csrf)
          return reply.code(403).send({ error: "CSRF token required" });
      }
    }
  });
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    return payload;
  });
  app.setErrorHandler((error: any, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (error.code?.startsWith("SQLITE_CONSTRAINT"))
      return reply.code(409).send({
        error: "Конфликт данных: имя занято или операция нарушает связи",
      });
    const status = error.statusCode || 500;
    if (status >= 500) app.log.error({ err: error }, "Request failed");
    return reply.code(status).send({
      error: status === 500 ? "Внутренняя ошибка сервера" : error.message,
      code: error.code || "REQUEST_ERROR",
      retryAfterMs: error.retryAfterMs,
    });
  });
  const io = new Server(app.server, { maxHttpBufferSize: 10000 });
  setIO(io);
  setNotifyPublisher((userId, event, payload) =>
    io.to(`user:${userId}`).emit(event, payload),
  );
  initializeNotify();
  syncSanctions("startup");
  maintainGovernance();
  io.use((socket, next) => {
    const token = socket.handshake.headers.cookie?.match(
      /(?:^|;\s*)session=([^;]+)/,
    )?.[1];
    const s =
      token &&
      one(
        "SELECT * FROM sessions WHERE token=? AND expires_at>?",
        token,
        now(),
      );
    if (!s) return next(new Error("Unauthorized"));
    const origin = socket.handshake.headers.origin;
    if (
      origin &&
      origin !== process.env.PUBLIC_ORIGIN &&
      origin !== `http://${socket.handshake.headers.host}` &&
      !/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin)
    )
      return next(new Error("Origin rejected"));
    socket.data.userId = s.user_id;
    socket.data.token = token;
    next();
  });
  io.on("connection", (socket) => {
    socket.use((_packet, next) => {
      if (
        !one(
          "SELECT 1 FROM sessions WHERE token=? AND expires_at>?",
          socket.data.token,
          now(),
        )
      ) {
        socket.disconnect(true);
        return next(new Error("Session expired"));
      }
      next();
    });
    socket.join(`user:${socket.data.userId}`);
    run(
      "UPDATE users SET presence_until=?,last_seen=? WHERE id=?",
      now() + 60000,
      now(),
      socket.data.userId,
    );
    socket.on("presence", () => {
      const u = one("SELECT status FROM users WHERE id=?", socket.data.userId);
      if (u?.status === "active")
        run(
          "UPDATE users SET presence_until=?,last_seen=? WHERE id=?",
          now() + 60000,
          now(),
          socket.data.userId,
        );
    });
    let last = 0;
    socket.on("typing", (payload: any) => {
      const spaceId = payload?.spaceId;
      if (typeof spaceId !== "string" || now() - last < 1000) return;
      last = now();
      try {
        member(socket.data.userId, spaceId, true);
        const users = one(
          "SELECT display_name FROM users WHERE id=?",
          socket.data.userId,
        );
        socket.to(`space:${spaceId}`).emit("typing", {
          spaceId,
          name: users?.display_name,
        });
      } catch {}
    });
    socket.on("join-space", (spaceId: string) => {
      try {
        member(socket.data.userId, spaceId);
        for (const room of socket.rooms)
          if (room.startsWith("space:")) socket.leave(room);
        socket.join(`space:${spaceId}`);
      } catch {}
    });
  });
  await authRoutes(app);
  await userRoutes(app);
  await messagingRoutes(app);
  await managementRoutes(app);
  await forumRoutes(app);
  await mediaRoutes(app);
  await avatarRoutes(app);
  await adminRoutes(app);
  await providerRoutes(app);
  await aiSetupRoutes(app);
  await metricsRoutes(app);
  await notifyRoutes(app);
  await governanceRoutes(app);
  await desktopRoutes(app);
  await ownershipRoutes(app);
  await personaRoutes(app);
  await evaluationRoutes(app);
  await policyRoutes(app);
  app.get("/api/health", async () => ({ ok: true, version: "3.0.0" }));
  const web = path.resolve("dist/web");
  if (existsSync(web)) {
    await app.register(fastifyStatic, { root: web });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Маршрут не найден" })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("onClose", async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
  return app;
}
