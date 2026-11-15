import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../core.js";
import { requestTransfer, resolveTransfer } from "./ownership.js";
export async function ownershipRoutes(app: FastifyInstance) {
  app.post("/api/spaces/:id/transfer", async (req) => {
    const b = z.object({ username: z.string().min(3).max(33) }).parse(req.body);
    return {
      id: requestTransfer(
        requireUser(req).user_id,
        (req.params as any).id,
        b.username,
      ),
    };
  });
  app.post("/api/notify/transfers/:id", async (req) => {
    const b = z
      .object({ action: z.enum(["accept", "reject", "cancel"]) })
      .parse(req.body);
    resolveTransfer(
      requireUser(req, true).user_id,
      (req.params as any).id,
      b.action,
    );
    return { ok: true };
  });
}
