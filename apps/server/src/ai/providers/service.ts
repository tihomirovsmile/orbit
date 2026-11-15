import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { all, one, run, id, now } from "../../database/index.js";
import { HttpError } from "../../core.js";
import { decrypt, validateEndpoint, privateIP } from "./security.js";
import { reserve, finishUsage, limits } from "../../billing/index.js";
import { providerSlot } from "./gate.js";
import { visibleText } from "./output.js";
import { currentCatalogModel } from "../../../../../packages/shared/model-recommendations.js";
import { enrichCatalogModel } from "./recommendations.js";
export async function providerRequest(
  p: any,
  route: string,
  body?: unknown,
): Promise<any> {
  const base = await validateEndpoint(p.base_url, !!p.trusted_local);
  const url = new URL(base + route);
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {
    all: true,
  });
  if (!p.trusted_local && addresses.some((a) => privateIP(a.address)))
    throw new HttpError(400, "Внутренний адрес запрещён");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(p.headers_secret ? JSON.parse(decrypt(p.headers_secret)) : {}),
  };
  if (p.secret) headers.Authorization = `Bearer ${decrypt(p.secret)}`;
  const data = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: body ? "POST" : "GET",
        headers,
        timeout: p.timeout,
        agent: false,
        lookup: ((_host: any, options: any, cb: any) => {
          if (options.all) cb(null, addresses);
          else cb(null, addresses[0].address, addresses[0].family);
        }) as any,
      },
      (res) => {
        let result = "";
        res.on("error", () =>
          reject(
            new HttpError(
              502,
              "Соединение с провайдером оборвалось во время ответа. Проверьте подключение перед повтором.",
              "PROVIDER_CONNECTION",
            ),
          ),
        );
        res.on("data", (chunk) => {
          result += chunk;
          if (result.length > 8_000_000)
            request.destroy(new Error("Ответ провайдера слишком большой"));
        });
        res.on("end", () => {
          let parsed: any;
          try {
            parsed = JSON.parse(result);
          } catch {}
          if ((res.statusCode || 500) >= 300 || parsed?.error) {
            const status =
              (res.statusCode || 500) >= 300
                ? res.statusCode!
                : Number(parsed.error.code) || 502;
            let message = "";
            try {
              const detail = JSON.parse(result).error?.message;
              message = typeof detail === "string" ? detail : "";
            } catch {}
            if (p.secret)
              message = message.replaceAll(decrypt(p.secret), "[скрыто]");
            message = message
              .replace(/Bearer\s+\S+/gi, "[скрыто]")
              .slice(0, 240);
            const info: Record<number, string> = {
              429: "Провайдер ограничил частоту запросов. Задания ожидают автоматического повтора.",
              401: "Провайдер не принял API-ключ. Проверьте ключ подключения.",
              403: "У подключения нет доступа к модели. Выберите доступную модель.",
              402: "Недостаточно средств у провайдера. Пополните баланс или выберите другую модель.",
              404: "Модель или адрес API не найдены. Обновите каталог моделей.",
              400: "Провайдер отклонил параметры запроса. Проверьте выбранную модель.",
            };
            const error = new HttpError(
              status === 429 ? 429 : status === 503 ? 503 : 502,
              `${info[status] || "Провайдер временно недоступен."}${message ? " " + message : ""}`,
            );
            error.code =
              status === 429
                ? "PROVIDER_RATE_LIMIT"
                : status === 503
                  ? "PROVIDER_UNAVAILABLE"
                  : status === 401 || status === 403
                    ? "PROVIDER_AUTH"
                    : status === 402
                      ? "PROVIDER_CREDIT"
                      : "PROVIDER_REQUEST";
            (error as any).providerStatus = status;
            if (status === 429 || status === 503) {
              const h = String(res.headers["retry-after"] || "");
              const seconds = Number(h);
              error.retryAfterMs = Math.max(
                1000,
                Math.min(
                  8_640_000_000_000_000 - now(),
                  Number.isFinite(seconds) && h
                    ? seconds * 1000
                    : Number.isFinite(Date.parse(h))
                      ? Date.parse(h) - now()
                      : 30000,
                ),
              );
              run(
                "UPDATE providers SET cooldown_until=?,last_error=? WHERE id=?",
                now() + error.retryAfterMs,
                error.message,
                p.id,
              );
            }
            reject(error);
            return;
          }
          try {
            resolve(JSON.parse(result));
          } catch {
            reject(new HttpError(502, "Провайдер вернул некорректный JSON"));
          }
        });
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("Таймаут провайдера")),
    );
    request.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        new HttpError(
          502,
          `Ошибка соединения с провайдером (${error.code || "network"})`,
        ),
      ),
    );
    if (data) request.write(data);
    request.end();
  });
}
export async function loadModels(p: any) {
  let response: any;
  for (let attempt = 0; attempt <= p.retries; attempt++) {
    try {
      response = await providerRequest(p, "/models");
      break;
    } catch (e) {
      if (attempt >= p.retries || [429, 503].includes((e as any).statusCode))
        throw e;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(3000, 300 * (attempt + 1))),
      );
    }
  }
  if (!Array.isArray(response.data))
    throw new HttpError(502, "Отсутствует каталог data[]");
  for (const m of response.data) {
    if (typeof m.id === "string")
      run(
        "INSERT INTO models VALUES(?,?,?) ON CONFLICT(provider_id,id) DO UPDATE SET data=excluded.data",
        p.id,
        m.id,
        JSON.stringify(enrichCatalogModel(p, m)),
      );
  }
  return response.data;
}
export function configuration(
  task: string,
  overrideModel?: string | { providerId: string; modelId: string },
) {
  const c =
    typeof overrideModel === "object"
      ? {
          provider_id: overrideModel.providerId,
          model_id: overrideModel.modelId,
        }
      : one("SELECT * FROM model_configurations WHERE task='message'");
  if (!c) throw new HttpError(503, "Назначьте модель в настройках ИИ");
  const p = one("SELECT * FROM providers WHERE id=?", c.provider_id);
  if (!p) throw new HttpError(503, "Провайдер не подключён");
  const modelId = c.model_id;
  const model = one(
    "SELECT data FROM models WHERE provider_id=? AND id=?",
    p.id,
    modelId,
  );
  if (!model) throw new HttpError(503, "Обновите каталог моделей");
  return { p, model: currentCatalogModel(JSON.parse(model.data)), modelId };
}
export async function complete(
  task: string,
  messages: { role: string; content: string }[],
  agentId: string | null = null,
  overrideModel?: string | { providerId: string; modelId: string },
) {
  const { p, model, modelId } = configuration(task, overrideModel);
  const release = await providerSlot(p.id, Math.max(1, p.concurrency));
  let usageId: string | undefined,
    settled = false;
  let inputBound = 0,
    outputBound = 0,
    reserved = 0;
  try {
    const cooldown =
      one("SELECT cooldown_until FROM providers WHERE id=?", p.id)
        ?.cooldown_until || 0;
    if (cooldown > now()) {
      const e = new HttpError(
        429,
        "Ожидаем разрешённое время следующего запроса к провайдеру.",
      );
      e.code = "PROVIDER_COOLDOWN";
      e.retryAfterMs = cooldown - now();
      throw e;
    }
    const l = limits();
    const bounded = messages.map((m) => ({
      ...m,
      content: m.content.slice(0, 12000),
    }));
    inputBound = bounded.reduce(
      (n, m) => n + Buffer.byteLength(m.content, "utf8") + 32,
      32,
    );
    outputBound = l.maxOutput;
    if (model.context_length && inputBound + outputBound > model.context_length)
      throw new HttpError(400, "Контекст превышает окно модели");
    const pricing = model.pricing || {};
    const known =
      pricing.prompt !== undefined &&
      pricing.completion !== undefined &&
      Number.isFinite(Number(pricing.prompt)) &&
      Number(pricing.prompt) >= 0 &&
      Number.isFinite(Number(pricing.completion)) &&
      Number(pricing.completion) >= 0;
    reserved = known
      ? inputBound * Number(pricing.prompt) +
        outputBound * Number(pricing.completion) +
        Math.max(0, Number(pricing.request) || 0)
      : l.unknownPriceReserve;
    usageId = reserve(
      p.id,
      modelId,
      agentId,
      task,
      reserved,
      inputBound + outputBound,
    );
    run(
      "UPDATE token_usage SET pricing_snapshot=? WHERE id=?",
      JSON.stringify({
        pricing,
        known,
        source: model.priceSource || p.base_url,
        checkedAt: model.priceCheckedAt || null,
        recordedAt: now(),
      }),
      usageId,
    );
    const response = await providerRequest(p, "/chat/completions", {
      model: modelId,
      messages: bounded,
      max_tokens: outputBound,
      temperature: 0.85,
      ...(p.type === "openrouter" ? { reasoning: { exclude: true } } : {}),
      ...(new URL(p.base_url).hostname === "api.deepseek.com"
        ? { thinking: { type: "disabled" } }
        : {}),
      ...(model.supported_parameters?.includes("response_format") &&
      bounded.some((m) => /json/i.test(m.content))
        ? { response_format: { type: "json_object" } }
        : {}),
    });
    const text = visibleText(response.choices?.[0]?.message);
    const usage = response.usage || {},
      input = usage.prompt_tokens ?? inputBound,
      output = usage.completion_tokens ?? outputBound;
    const cost =
      typeof usage.cost === "number"
        ? Math.max(0, usage.cost)
        : known
          ? input * Number(pricing.prompt) +
            output * Number(pricing.completion) +
            Math.max(0, Number(pricing.request) || 0)
          : reserved;
    finishUsage(
      usageId,
      input,
      output,
      cost,
      undefined,
      typeof usage.cost !== "number",
    );
    settled = true;
    if (response.choices?.[0]?.finish_reason === "length") {
      const e = new HttpError(
        422,
        "Ответ обрезан по лимиту токенов. Для думающей модели выберите 4096–8192 токенов или модель без длинных рассуждений.",
      );
      e.code = "AI_OUTPUT_LIMIT";
      throw e;
    }
    if (!text) {
      const e = new HttpError(
        422,
        "Модель не вернула окончательный ответ: доступны только рассуждения или пустой content. Увеличьте лимит токенов либо смените модель.",
      );
      e.code = "AI_EMPTY_FINAL";
      throw e;
    }
    run(
      "UPDATE providers SET last_error=NULL,cooldown_until=0 WHERE id=?",
      p.id,
    );
    return { text, usage: { input, output, cost }, model: modelId };
  } catch (error) {
    const rejected =
      (error as any).providerStatus >= 400 &&
      (error as any).providerStatus < 500;
    if (usageId && !settled)
      finishUsage(
        usageId,
        rejected ? 0 : inputBound,
        rejected ? 0 : outputBound,
        rejected ? 0 : reserved,
        (error as Error).message,
        true,
      );
    throw error;
  } finally {
    release();
  }
}
