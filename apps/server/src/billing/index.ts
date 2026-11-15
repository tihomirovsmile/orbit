import {
  all,
  one,
  run,
  tx,
  id,
  now,
  setting,
  setSetting,
} from "../database/index.js";
import { HttpError, notify } from "../core.js";
export const defaultLimits = {
  daily: 2,
  monthly: 20,
  maxAgents: 100,
  maxActive: 5,
  rpm: 12,
  agentTokens: 50000,
  maxGenerations: 1000,
  maxOutput: 4096,
  unknownPriceReserve: 0.1,
};
export const limits = () => ({ ...defaultLimits, ...setting("limits", {}) });
export function totals() {
  const day = new Date().toISOString().slice(0, 10),
    month = day.slice(0, 7);
  return {
    daily: one(
      "SELECT coalesce(sum(cost+reservation),0) n FROM token_usage WHERE strftime('%Y-%m-%d',created_at/1000,'unixepoch')=?",
      day,
    )!.n,
    monthly: one(
      "SELECT coalesce(sum(cost+reservation),0) n FROM token_usage WHERE strftime('%Y-%m',created_at/1000,'unixepoch')=?",
      month,
    )!.n,
    ...one(
      "SELECT coalesce(sum(input_tokens),0) inputTokens,coalesce(sum(output_tokens),0) outputTokens,coalesce(sum(cost),0) cost,count(*) requests FROM token_usage",
    ),
    reserved: one("SELECT coalesce(sum(reservation),0) n FROM token_usage")!.n,
  };
}
export function reserve(
  providerId: string,
  modelId: string,
  agentId: string | null,
  task: string,
  maxCost: number,
  maxTokens: number,
) {
  if (
    !Number.isFinite(maxCost) ||
    maxCost < 0 ||
    !Number.isFinite(maxTokens) ||
    maxTokens < 0
  )
    throw new HttpError(400, "Некорректный бюджетный резерв");
  const result = tx(() => {
    const l = limits(),
      t = totals();
    if (t.daily + maxCost > l.daily || t.monthly + maxCost > l.monthly) {
      return null;
    }
    if (
      one(
        "SELECT count(*) n FROM token_usage WHERE created_at>?",
        now() - 60000,
      )!.n >= l.rpm
    ) {
      const error = new HttpError(
        429,
        "Достигнут локальный лимит запросов в минуту. Очередь продолжится автоматически.",
      );
      error.code = "LOCAL_RATE_LIMIT";
      error.retryAfterMs = 60000;
      throw error;
    }
    if (
      one(
        "SELECT count(*) n FROM token_usage WHERE created_at>?",
        now() - 86400000,
      )!.n >= l.maxGenerations
    )
      throw new HttpError(402, "Дневной лимит генераций");
    if (
      agentId &&
      one(
        "SELECT coalesce(sum(input_tokens+output_tokens),0)+coalesce(sum(CASE WHEN status='reserved' THEN ? ELSE 0 END),0) n FROM token_usage WHERE agent_id=? AND created_at>=?",
        maxTokens,
        agentId,
        Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z"),
      )!.n +
        maxTokens >
        l.agentTokens
    )
      throw new HttpError(
        402,
        "Дневной лимит токенов личности; очередь продолжит работу после нового дня UTC",
      );
    const usageId = id();
    run(
      "INSERT INTO token_usage(id,provider_id,model_id,agent_id,task,reservation,status,created_at) VALUES(?,?,?,?,?,?,'reserved',?)",
      usageId,
      providerId,
      modelId,
      agentId,
      task,
      maxCost,
      now(),
    );
    return usageId;
  });
  if (!result) {
    if (!setting("budgetNotified", false)) {
      for (const u of all("SELECT id FROM users WHERE role='OWNER'"))
        notify(
          u.id,
          "budget",
          "Достигнут лимит бюджета. Платные задания ожидают.",
          "billing",
        );
      setSetting("budgetNotified", true);
    }
    throw new HttpError(402, "Лимит бюджета: задание сохранено в очереди");
  }
  return result;
}
export function finishUsage(
  usageId: string,
  input: number,
  output: number,
  cost: number,
  error?: string,
  estimated = false,
) {
  run(
    "UPDATE token_usage SET input_tokens=?,output_tokens=?,cost=?,reservation=0,status=?,error=? WHERE id=?",
    input,
    output,
    cost,
    error ? "error" : estimated ? "estimated" : "complete",
    error || null,
    usageId,
  );
}
