import type { FastifyInstance } from "fastify";
import os from "node:os";
import { statfsSync } from "node:fs";
import { all, one, run, now, dataDir, audit } from "../database/index.js";
import { requireAdmin, requireOwner, HttpError, emit } from "../core.js";
import { z } from "zod";
let cpu = process.cpuUsage(),
  sampleAt = performance.now();
export async function metricsRoutes(app: FastifyInstance) {
  app.get("/api/admin/metrics", async (req) => {
    requireAdmin(req);
    const elapsed = performance.now() - sampleAt,
      next = process.cpuUsage(),
      cpuPercent = Math.min(
        100,
        Math.max(
          0,
          ((next.user - cpu.user + (next.system - cpu.system)) /
            Math.max(1, elapsed * 1000)) *
            100,
        ),
      );
    cpu = next;
    sampleAt = performance.now();
    let disk: any = null;
    try {
      const stat = statfsSync(dataDir);
      disk = {
        total: stat.blocks * stat.bsize,
        available: stat.bavail * stat.bsize,
      };
    } catch {}
    const hours = Array.from({ length: 24 }, (_, i) => {
      const end = Math.floor(now() / 3600000) * 3600000 - (23 - i) * 3600000;
      return {
        at: end,
        messages: one(
          "SELECT count(*) n FROM messages WHERE created_at>=? AND created_at<?",
          end,
          end + 3600000,
        )!.n,
        registrations: one(
          "SELECT count(*) n FROM users WHERE created_at>=? AND created_at<?",
          end,
          end + 3600000,
        )!.n,
      };
    });
    return {
      sampleAt: now(),
      cpuPercent: elapsed > 1000 ? cpuPercent : null,
      processMemory: process.memoryUsage().rss,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      disk,
      uptime: process.uptime(),
      hours,
      apiErrors: one(
        "SELECT count(*) n FROM token_usage WHERE status='error' AND created_at>?",
        now() - 86400000,
      )!.n,
    };
  });
  app.put("/api/admin/verification", async (req) => {
    requireOwner(req);
    throw new HttpError(
      410,
      "Галочка пользователя рассчитывается автоматически по действующим статусам принадлежащих каналов. Откройте действие «Статус сообщества».",
    );
  });
}
