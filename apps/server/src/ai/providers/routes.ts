import { currentCatalogModel } from "../../../../../packages/shared/model-recommendations.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { all, one, run, tx, id, now, audit } from "../../database/index.js";
import { requireAiManager, HttpError } from "../../core.js";
import { encrypt, validateEndpoint } from "./security.js";
import { loadModels, complete, providerRequest } from "./service.js";
import {
  recommendations,
  recommendationDate,
  catalogFilter,
} from "./recommendations.js";
export async function providerRoutes(app: FastifyInstance) {
  app.get("/api/admin/providers", async (req) => {
    requireAiManager(req);
    return {
      providers: all(
        "SELECT id,name,type,base_url baseUrl,timeout,retries,concurrency,trusted_local trustedLocal,is_primary isPrimary,secret IS NOT NULL hasKey FROM providers",
      ),
      assignments: all(
        "SELECT task,provider_id providerId,model_id modelId FROM model_configurations",
      ),
    };
  });
  app.post("/api/admin/providers", async (req) => {
    const s = requireAiManager(req);
    const b = z
      .object({
        id: z.string().optional(),
        name: z.string().min(1).max(80),
        type: z.enum(["openrouter", "compatible", "local"]),
        baseUrl: z.string().url(),
        apiKey: z
          .string()
          .trim()
          .max(1000)
          .refine(
            (value) => !/[\r\n]/.test(value),
            "Вставьте только API-ключ одной строкой, без пояснений",
          )
          .optional(),
        headers: z.record(z.string(), z.string().max(1000)).default({}),
        timeout: z.number().int().min(1000).max(120000).default(30000),
        retries: z.number().int().min(0).max(3).default(1),
        concurrency: z.number().int().min(1).max(10).default(2),
        trustedLocal: z.boolean().default(false),
        isPrimary: z.boolean().default(true),
      })
      .parse(req.body);
    if (
      b.type === "openrouter" &&
      b.baseUrl.replace(/\/$/, "") !== "https://openrouter.ai/api/v1"
    )
      throw new HttpError(400, "Используйте официальный адрес OpenRouter");
    for (const key of Object.keys(b.headers))
      if (!/^(x-[\w-]+|HTTP-Referer)$/i.test(key))
        throw new HttpError(400, "Разрешены только X-* и HTTP-Referer");
    const base = await validateEndpoint(b.baseUrl, b.trustedLocal),
      providerId = b.id || id();
    const previous =
      b.id && one("SELECT base_url,secret FROM providers WHERE id=?", b.id);
    if (
      previous?.secret &&
      new URL(previous.base_url).hostname !== new URL(base).hostname &&
      !b.apiKey
    )
      throw new HttpError(
        400,
        "Для другого провайдера создайте новое подключение или вставьте его собственный API-ключ. Старый ключ нельзя переносить на другой сервер.",
      );
    tx(() => {
      if (b.isPrimary) run("UPDATE providers SET is_primary=0");
      run(
        "INSERT INTO providers(id,name,type,base_url,secret,headers_secret,timeout,retries,concurrency,trusted_local,is_primary,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,base_url=excluded.base_url,secret=coalesce(excluded.secret,providers.secret),headers_secret=excluded.headers_secret,timeout=excluded.timeout,retries=excluded.retries,concurrency=excluded.concurrency,trusted_local=excluded.trusted_local,is_primary=excluded.is_primary,cooldown_until=0,last_error=NULL",
        providerId,
        b.name,
        b.type,
        base,
        b.apiKey ? encrypt(b.apiKey) : null,
        encrypt(JSON.stringify(b.headers)),
        b.timeout,
        b.retries,
        b.concurrency,
        Number(b.trustedLocal),
        Number(b.isPrimary),
        now(),
      );
      audit(s.user_id, "provider.save", providerId, {
        type: b.type,
        baseUrl: base,
        trustedLocal: b.trustedLocal,
      });
    });
    return { id: providerId };
  });
  app.post("/api/admin/providers/:id/test", async (req) => {
    requireAiManager(req);
    const p = one("SELECT * FROM providers WHERE id=?", (req.params as any).id);
    if (!p) throw new HttpError(404, "Провайдер не найден");
    const result = await providerRequest(p, "/models");
    return { ok: Array.isArray(result.data), count: result.data?.length || 0 };
  });
  app.post("/api/admin/providers/:id/models", async (req) => {
    requireAiManager(req);
    const p = one("SELECT * FROM providers WHERE id=?", (req.params as any).id);
    if (!p) throw new HttpError(404, "Провайдер не найден");
    return loadModels(p);
  });
  app.get("/api/admin/models", async (req) => {
    requireAiManager(req);
    return all(
      "SELECT m.provider_id,m.data,p.type provider_type,p.name provider_name,p.base_url FROM models m JOIN providers p ON p.id=m.provider_id",
    ).map((m) => ({
      ...currentCatalogModel(JSON.parse(m.data)),
      providerId: m.provider_id,
      providerName: m.provider_name,
      providerKind:
        m.provider_type === "local"
          ? "local"
          : m.provider_type === "openrouter"
            ? "router"
            : "direct",
    }));
  });
  app.get("/api/admin/model-recommendations", async (req) => {
    requireAiManager(req);
    return {
      asOf: recommendationDate,
      checkedAt: recommendationDate,
      method:
        "Официальные тарифы и отдельные отзывы пользователей; не консенсус и не сертификация качества. Результаты собственного прогона Orbit отображаются отдельно.",
      items: recommendations,
    };
  });
  app.get("/api/admin/models/search", async (req) => {
    requireAiManager(req);
    const q = req.query as any,
      models = all(
        "SELECT m.*,p.type provider_type,p.name provider_name FROM models m JOIN providers p ON p.id=m.provider_id",
      ).map((m) => ({
        ...currentCatalogModel(JSON.parse(m.data)),
        providerId: m.provider_id,
        providerName: m.provider_name,
        providerKind:
          m.provider_type === "local"
            ? "local"
            : m.provider_type === "openrouter"
              ? "router"
              : "direct",
      }));
    const found = catalogFilter(models, {
      providerKind: "direct",
      budget: "true",
      excludeSmall: "true",
      ...q,
    });
    const offset = Math.max(0, Number(q.offset) || 0);
    return {
      items: found.slice(offset, offset + 100),
      total: found.length,
      nextOffset: offset + 100 < found.length ? offset + 100 : null,
    };
  });
  app.post("/api/admin/models/assign", async (req) => {
    const s = requireAiManager(req);
    const b = z
      .object({
        task: z.enum([
          "personality",
          "message",
          "memory",
          "moderation",
          "planning",
        ]),
        providerId: z.string(),
        modelId: z.string(),
      })
      .parse(req.body);
    if (
      !one(
        "SELECT 1 FROM models WHERE provider_id=? AND id=?",
        b.providerId,
        b.modelId,
      )
    )
      throw new HttpError(400, "Модель не найдена в каталоге");
    for (const task of [
      "personality",
      "message",
      "memory",
      "moderation",
      "planning",
    ])
      run(
        "INSERT INTO model_configurations VALUES(?,?,?) ON CONFLICT(task) DO UPDATE SET provider_id=excluded.provider_id,model_id=excluded.model_id",
        task,
        b.providerId,
        b.modelId,
      );
    run("UPDATE ai_personas SET model_id=NULL");
    audit(s.user_id, "model.assign", b.modelId, { task: b.task });
    return { ok: true };
  });
  app.post("/api/admin/playground", async (req) => {
    requireAiManager(req);
    const b = z
      .object({
        task: z.enum(["profile", "dm", "post", "dialogue"]),
        prompt: z.string().max(3000),
      })
      .parse(req.body);
    return complete("message", [
      {
        role: "system",
        content: `You are a quality testing sandbox. Generate a ${b.task} in the requested language. Output is never published to the network. Clearly label any simulated public figure.`,
      },
      { role: "user", content: b.prompt },
    ]);
  });
}
