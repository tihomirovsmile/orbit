export const recommendationDate = "2026-11-14";
export const recommendations = [
  {
    id: "deepinfra-v4-flash",
    provider: "DeepInfra",
    providerKind: "direct",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    modelId: "deepseek-ai/DeepSeek-V4-Flash",
    name: "DeepSeek V4 Flash",
    input: 0.09,
    output: 0.18,
    cachedInput: 0.018,
    parametersB: 284,
    context: 1000000,
    recommended: true,
    tier: "budget",
    priceSource: "https://deepinfra.com/deepseek-ai/DeepSeek-V4-Flash",
    reviewSources: [
      "https://www.reddit.com/r/SillyTavernAI/comments/1vgdr49/cheap_user/",
    ],
    pros: [
      "Участники обсуждения отмечают удачное соотношение цены и разговорного качества.",
      "При обычном тарифе обе цены ниже порога $0,25.",
    ],
    cons: [
      "В том же обсуждении отмечены трудности при очень длинном контексте и точных сложных инструкциях.",
      "Версии и квантование у разных провайдеров могут различаться; нужен тест Orbit.",
    ],
    confidence:
      "Отдельные пользовательские отзывы, не консенсус и не тест Orbit",
  },
  {
    id: "deepinfra-gpt-oss",
    provider: "DeepInfra",
    providerKind: "direct",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    modelId: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    input: 0.037,
    output: 0.17,
    parametersB: 117,
    context: 131072,
    recommended: false,
    tier: "budget",
    priceSource: "https://deepinfra.com/openai/gpt-oss-120b",
    reviewSources: [
      "https://www.reddit.com/r/LocalLLaMA/comments/1rpqy9z/gpt_oss_120b_or_qwen_35_for/",
      "https://www.reddit.com/r/SillyTavernAI/comments/1v6a104/gemini_35_flash_lite_is_actually_good_for_rp/",
    ],
    pros: [
      "Обе цены входят в заданный бюджет; крупная модель, не малый миллиардер.",
      "Есть положительные отдельные сообщения о работе с другими языками.",
    ],
    cons: [
      "Есть прямые жалобы пользователей на русский язык.",
      "Для русскоязычной симуляции это запасной кандидат, а не первый выбор. Проверьте финальные ответы и структурированный профиль.",
    ],
    confidence:
      "Отзывы противоречивы; рекомендация только после собственного прогона",
  },
  {
    id: "deepinfra-qwen235",
    provider: "DeepInfra",
    providerKind: "direct",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    modelId: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    name: "Qwen3 235B A22B Instruct 2507",
    input: 0.09,
    output: 0.55,
    parametersB: 235,
    context: 262144,
    recommended: true,
    tier: "extended",
    priceSource: "https://deepinfra.com/Qwen/Qwen3-235B-A22B-Instruct-2507",
    reviewSources: [
      "https://www.reddit.com/r/SillyTavernAI/comments/1vgdr49/cheap_user/",
      "https://www.reddit.com/r/LocalLLaMA/comments/1vkoxd7/best_current_erp_base_model_that_are_smart_and/",
    ],
    pros: [
      "В пользовательских обсуждениях хвалят управляемость и ролевые диалоги.",
      "Вариант Instruct удобен для проверки коротких окончательных ответов.",
    ],
    cons: [
      "Выходные токены дороже лимита $0,25.",
      "Встречаются жалобы на манерное оформление текста; стиль нужно проверить на своих персонажах.",
    ],
    confidence:
      "Датированные обсуждения пользователей; художественное качество субъективно",
  },
  {
    id: "deepseek-native",
    provider: "DeepSeek",
    providerKind: "direct",
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-flash",
    name: "DeepSeek V4.1 Flash · прямой API",
    input: 0.3,
    output: 1.2,
    offPeak: { input: 0.15, output: 0.6 },
    context: 1000000,
    parametersB: null,
    recommended: false,
    tier: "extended",
    priceSource: "https://api-docs.deepseek.com/quick_start/pricing/",
    reviewSources: [
      "https://www.reddit.com/r/SillyTavernAI/comments/1vgdr49/cheap_user/",
    ],
    pros: [
      "Прямое подключение к разработчику модели.",
      "Пользователи обсуждают семейство Flash как доступный вариант для диалогов.",
    ],
    cons: [
      "Даже непиковая цена выхода выше $0,25.",
      "Текущая версия отличается от DeepInfra V4 Flash. Нельзя переносить отзывы между версиями без проверки.",
    ],
    confidence:
      "Цены официальные; отзывы о семействе, не сертификация конкретной версии",
  },
  {
    id: "deepinfra-glm",
    provider: "DeepInfra",
    providerKind: "direct",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    modelId: "zai-org/GLM-5.3-Flash",
    name: "GLM 5.3 Flash",
    input: 0.15,
    output: 0.5,
    cachedInput: 0.03,
    parametersB: null,
    context: 1048576,
    recommended: false,
    tier: "extended",
    priceSource: "https://deepinfra.com/zai-org/GLM-5.3-Flash",
    reviewSources: [
      "https://www.reddit.com/r/SillyTavernAI/comments/1winqkn/free_deepseek_v4_glm_53_and_qwen_38_api_for/",
    ],
    pros: [
      "В обсуждении пользователь предлагает сравнить GLM с Flash и Qwen для диалогов.",
      "Есть поддержка структурированного вывода на странице провайдера.",
    ],
    cons: [
      "Цена выхода выше бюджетного порога.",
      "Размер модели и качество русского в Orbit не подтверждены этим обзором.",
    ],
    confidence:
      "Ограниченный пользовательский опыт; дополнительный кандидат, не лидер рейтинга",
  },
].map((r) => ({
  ...r,
  checkedAt: recommendationDate,
  reviewDisclaimer:
    "Пересказ конкретных пользовательских сообщений со ссылками. Это не мнение всех пользователей и не результаты платного теста Orbit.",
}));
export function enrichCatalogModel(provider: any, model: any) {
  let host = "";
  try {
    host = new URL(provider.base_url).hostname;
  } catch {
    return model;
  }
  const match = recommendations.find(
    (r) => new URL(r.baseUrl).hostname === host && r.modelId === model.id,
  );
  if (!match || Date.now() - Date.parse(recommendationDate) > 30 * 86400000)
    return model;
  return {
    ...model,
    name: model.name || match.name,
    context_length: model.context_length || match.context,
    parameter_count:
      model.parameter_count ||
      (match.parametersB ? match.parametersB * 1e9 : undefined),
    supported_parameters: model.supported_parameters || ["response_format"],
    pricing: model.pricing || {
      prompt: String(match.input / 1e6),
      completion: String(match.output / 1e6),
    },
    priceSource: match.priceSource,
    priceCheckedAt: recommendationDate,
    priceEstimated: true,
  };
}
export function catalogFilter(models: any[], q: any) {
  const maxInput = Number(q.maxInput ?? 0.25),
    maxOutput = Number(q.maxOutput ?? 0.25),
    minB = Number(q.minParameters ?? 50);
  return models
    .filter((m) => {
      if (/^(openrouter\/(auto|free|bodybuilder)|auto$|router:)/i.test(m.id))
        return false;
      if (
        q.providerKind &&
        q.providerKind !== "all" &&
        m.providerKind !== q.providerKind
      )
        return false;
      if (
        q.q &&
        !(String(m.name || "") + " " + m.id)
          .toLowerCase()
          .includes(String(q.q).toLowerCase())
      )
        return false;
      const input =
          m.pricing?.prompt === undefined
            ? null
            : Number(m.pricing.prompt) * 1e6,
        output =
          m.pricing?.completion === undefined
            ? null
            : Number(m.pricing.completion) * 1e6;
      if (
        q.budget === "true" &&
        (((input === null || output === null) && q.includeUnknown !== "true") ||
          (input !== null && input > maxInput) ||
          (output !== null && output > maxOutput))
      )
        return false;
      const match = String(m.name || m.id).match(/(\d+(?:\.\d+)?)\s*b\b/i),
        params =
          typeof m.parameter_count === "number"
            ? m.parameter_count / 1e9
            : match
              ? Number(match[1])
              : null;
      if (
        q.excludeSmall === "true" &&
        ((params !== null && params < minB) ||
          (params === null && q.includeUnknown !== "true"))
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const price = (m: any) =>
        Number(m.pricing?.prompt ?? Infinity) +
        Number(m.pricing?.completion ?? Infinity);
      return q.sort === "price-desc"
        ? price(b) - price(a)
        : q.sort === "name"
          ? String(a.name || a.id).localeCompare(String(b.name || b.id))
          : price(a) - price(b);
    });
}

export function currentCatalogModel(model: any) {
  if (
    model.priceEstimated &&
    model.priceCheckedAt &&
    Date.now() - Date.parse(model.priceCheckedAt) > 30 * 86400000
  )
    return { ...model, pricing: undefined, priceStale: true };
  return model;
}
