import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOwner } from "../core.js";
import { setting, setSetting, audit } from "../database/index.js";
import { mediaLimits, MiB } from "../media/limits.js";
export const governanceDefaults = {
  channelDeleteSeconds: 30,
  maxCommunitiesHuman: 100,
  maxCommunitiesAi: 6,
};
export async function policyRoutes(app: FastifyInstance) {
  app.get("/api/admin/policies", async (req) => {
    requireOwner(req);
    return {
      governance: { ...governanceDefaults, ...setting("governance", {}) },
      media: mediaLimits(),
      retention:
        "Служебная история не очищается автоматически по сроку. Резервные копии не переписываются при удалении аккаунта; владелец управляет их сроком хранения.",
    };
  });
  app.put("/api/admin/policies", async (req) => {
    const actor = requireOwner(req),
      b = z
        .object({
          governance: z.object({
            channelDeleteSeconds: z.number().int().min(30).max(86400),
            maxCommunitiesHuman: z.number().int().min(1).max(10000),
            maxCommunitiesAi: z.number().int().min(1).max(1000),
          }),
          documentMiB: z.number().int().min(1).max(800),
          attachments: z.number().int().min(1).max(10),
        })
        .parse(req.body);
    setSetting("governance", b.governance);
    setSetting("mediaLimits", {
      ...mediaLimits(),
      documentFile: b.documentMiB * MiB,
      attachments: b.attachments,
    });
    audit(actor.user_id, "settings.policy", null, b);
    return { ok: true };
  });
}
