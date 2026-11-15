import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  all,
  one,
  run,
  tx,
  setting,
  setSetting,
  audit,
  now,
} from "../database/index.js";
import { requireAiManager, HttpError, emit } from "../core.js";
import { limits, totals } from "../billing/index.js";
import { complete } from "../ai/providers/service.js";
import { parsePersona } from "../ai/personality/index.js";
export async function aiSetupRoutes(app: FastifyInstance) {
  app.get("/api/admin/ai/status", async (req) => {
    requireAiManager(req);
    const assignments = all(
      "SELECT task,provider_id providerId,model_id modelId FROM model_configurations",
    );
    const c = assignments.find((a) => a.task === "message");
    const providers = all(
      "SELECT id,name,type,base_url baseUrl,secret IS NOT NULL hasKey,cooldown_until cooldownUntil,last_error lastError FROM providers",
    );
    const model =
      c &&
      one(
        "SELECT data FROM models WHERE provider_id=? AND id=?",
        c.providerId,
        c.modelId,
      );
    const l = limits(),
      usage = totals();
    return {
      assignments,
      providers,
      selectedModel: model ? JSON.parse(model.data) : null,
      limits: l,
      usage,
      simulation: setting("simulation", {
        status: "stopped",
        mode: "live",
        target: 3,
        activity: 0.4,
        speed: 1,
      }),
      counts: all("SELECT status,count(*) count FROM ai_jobs GROUP BY status"),
      population: one("SELECT count(*) n FROM users WHERE type='ai'")!.n,
      jobs: all(
        "SELECT id,kind,status,attempts,max_attempts maxAttempts,run_at runAt,error,error_code code,created_at createdAt FROM ai_jobs ORDER BY created_at DESC LIMIT 60",
      ),
      ready:
        !!c && !!model && l.daily > 0 && l.monthly > 0 && l.maxOutput >= 2048,
      nextStep: !providers.length
        ? "provider"
        : !c || !model
          ? "model"
          : l.maxOutput < 2048
            ? "limits"
            : "start",
    };
  });
  app.post("/api/admin/ai/use-model", async (req) => {
    const s = requireAiManager(req),
      b = z
        .object({
          providerId: z.string(),
          modelId: z.string(),
          rpm: z.number().int().min(1).max(60).default(6),
          maxOutput: z.number().int().min(2048).max(8192).default(4096),
          daily: z.number().min(0.01).max(1000).default(2),
          monthly: z.number().min(0.01).max(10000).default(20),
        })
        .parse(req.body);
    if (
      !one(
        "SELECT 1 FROM models WHERE provider_id=? AND id=?",
        b.providerId,
        b.modelId,
      )
    )
      throw new HttpError(
        400,
        "Сначала загрузите каталог и выберите модель из него",
      );
    tx(() => {
      for (const task of [
        "personality",
        "message",
        "memory",
        "planning",
        "moderation",
      ])
        run(
          "INSERT INTO model_configurations VALUES(?,?,?) ON CONFLICT(task) DO UPDATE SET provider_id=excluded.provider_id,model_id=excluded.model_id",
          task,
          b.providerId,
          b.modelId,
        );
      run("UPDATE providers SET concurrency=1 WHERE id=?", b.providerId);
      run("UPDATE ai_personas SET model_id=NULL");
      setSetting("limits", {
        ...limits(),
        rpm: b.rpm,
        maxOutput: b.maxOutput,
        daily: b.daily,
        monthly: b.monthly,
        maxActive: 1,
      });
      setSetting("budgetNotified", false);
      audit(s.user_id, "ai.unified-model", b.modelId, {
        provider: b.providerId,
      });
    });
    return { ok: true };
  });
  app.post("/api/admin/ai/test", async (req) => {
    requireAiManager(req);
    const result = await complete("personality", [
      {
        role: "system",
        content:
          'Return ONLY valid JSON for a fictional adult profile, not a real person. Fields: displayName (1-60), username (ASCII 3-32), bio (may be empty), country, occupation, biography, interests (2-12 strings), goals (array), avatarStyle:"abstract", additionalLanguages: []. Keep biography under 300 characters. Do not include reasoning in the final answer.',
      },
      {
        role: "user",
        content:
          "Create a Russian-speaking person interested in art and music. This is a sandbox test, not an account registration.",
      },
    ]);
    const profile = parsePersona(result.text);
    return { ok: true, profile, usage: result.usage, model: result.model };
  });
  app.post("/api/admin/ai/recover", async (req) => {
    const s = requireAiManager(req);
    const b = z.object({ resume: z.boolean().default(false) }).parse(req.body);
    if (!one("SELECT 1 FROM model_configurations WHERE task='message'"))
      throw new HttpError(400, "Выберите рабочую модель");
    const recovered = run(
      "UPDATE ai_jobs SET status='queued',attempts=0,error=NULL,error_code=NULL,run_at=? WHERE status='failed'",
      now(),
    );
    if (b.resume)
      setSetting("simulation", {
        ...setting("simulation", {}),
        status: "running",
        reason: null,
      });
    audit(s.user_id, "ai.recover", null, { jobs: recovered.changes });
    emit();
    return { recovered: recovered.changes };
  });
}
