import { ModelEvaluation } from "./Policies";
import { ModelRecommendations, CatalogFilters } from "./ModelCatalog";
import { useEffect, useState } from "react";
import {
  Plug,
  Check,
  Search,
  Sparkles,
  Play,
  Pause,
  Square,
  RefreshCw,
  ArrowRight,
  Shield,
  Wallet,
  Timer,
  Users,
  KeyRound,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { api, post } from "../services/api";
import {
  useApp,
  Button,
  Field,
  Tag,
  useLoad,
  Loading,
  time,
} from "../components/UI";
export function AIHub() {
  const { toast, lang } = useApp(),
    state = useLoad<any>(() => api("/admin/ai/status"));
  const [step, setStep] = useState(1),
    [provider, setProvider] = useState(""),
    [model, setModel] = useState(""),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [test, setTest] = useState<any>(null),
    [target, setTarget] = useState(3),
    [connection, setConnection] = useState({
      id: undefined as string | undefined,
      name: "Совместимый API",
      type: "compatible",
      baseUrl: "https://api.deepinfra.com/v1/openai",
      apiKey: "",
      trustedLocal: false,
    }),
    [limits, setLimits] = useState({
      rpm: 6,
      maxOutput: 4096,
      daily: 2,
      monthly: 20,
    });
  const models = useLoad<any[]>(() => api("/admin/models"), []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) state.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!state.value) return;
    const v = state.value;
    if (!provider) {
      setProvider(
        v.assignments.find((a: any) => a.task === "message")?.providerId ||
          v.providers[0]?.id ||
          "",
      );
      setModel(
        v.assignments.find((a: any) => a.task === "message")?.modelId || "",
      );
      setTarget(Math.max(3, v.simulation.target || 3));
      setLimits({
        rpm: Math.min(60, v.limits.rpm),
        maxOutput: Math.max(4096, v.limits.maxOutput),
        daily: v.limits.daily || 2,
        monthly: v.limits.monthly || 20,
      });
      if (v.nextStep === "limits") setStep(2);
      else if (v.selectedModel && v.simulation.reason) setStep(3);
      else if (v.selectedModel) setStep(4);
      else if (v.providers.length) setStep(2);
    }
  }, [state.value]);
  async function work(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError("");
    try {
      await fn();
      state.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const v = state.value,
    selected = models.value?.find(
      (m) => m.providerId === provider && m.id === model,
    ),
    price = (p: any) =>
      p === undefined
        ? "Не указана"
        : `$${(Number(p) * 1e6).toFixed(3)} / 1 млн токенов`,
    jobs = v?.jobs || [];
  if (!v)
    return state.error ? (
      <div className="error">
        {state.error}
        <Button onClick={state.refresh}>Повторить</Button>
      </div>
    ) : (
      <Loading />
    );
  async function control(action: string) {
    await work(action, async () => {
      await post("/admin/simulation", {
        action,
        target,
        mode: "live",
        activity: 0.55,
        speed: 1,
      });
    });
  }
  return (
    <div className="ai-hub">
      <div className="ai-intro">
        <div className="provider-symbol">
          <Sparkles size={27} />
        </div>
        <div>
          <span className="eyebrow">ИНТЕЛЛЕКТ ORBIT</span>
          <h2>Одна модель. Живая сеть.</h2>
          <p>
            Подключите ИИ по четырём шагам. Мы проверим настройки до появления
            первых участников.
          </p>
        </div>
        <Tag tone={v.simulation.status === "running" ? "green" : ""}>
          {v.simulation.status === "running"
            ? "Работает"
            : v.simulation.status === "paused"
              ? "На паузе"
              : "Не запущено"}
        </Tag>
      </div>
      <nav className="setup-steps">
        {[
          [1, "Подключение", Plug],
          [2, "Модель", Sparkles],
          [3, "Проверка", Shield],
          [4, "Запуск", Play],
        ].map(([id, label, Icon]: any) => (
          <button
            key={id}
            className={step === id ? "active" : step > id ? "done" : ""}
            onClick={() => setStep(id)}
          >
            <span>{step > id ? <Check size={18} /> : id}</span>
            <div>
              <small>ШАГ {id}</small>
              <b>{label}</b>
            </div>
            <Icon size={19} />
          </button>
        ))}
      </nav>
      {error && (
        <div className="recovery-box error" role="alert">
          <AlertCircle size={22} />
          <div>
            <b>Нужно исправить один момент</b>
            <p>{error}</p>
            <small>
              Данные не потеряны. Исправьте настройку и повторите этот шаг.
            </small>
          </div>
        </div>
      )}
      {step === 1 && (
        <ModelRecommendations
          onConnection={(baseUrl, name) => {
            setConnection({
              id: undefined,
              name,
              type: "compatible",
              baseUrl,
              apiKey: "",
              trustedLocal: false,
            });
          }}
        />
      )}
      {step === 1 && (
        <section className="panel ai-step">
          <h2>1. Подключите провайдера</h2>
          <p className="muted">
            API-ключ хранится на сервере. После сохранения он не показывается в
            интерфейсе.
          </p>
          {v.providers.length > 0 && (
            <div className="existing-connections">
              {v.providers.map((p: any) => (
                <button
                  key={p.id}
                  className={provider === p.id ? "active" : ""}
                  onClick={() => {
                    setProvider(p.id);
                    setConnection({
                      id: p.id,
                      name: p.name,
                      type: p.type,
                      baseUrl: p.baseUrl,
                      apiKey: "",
                      trustedLocal: p.type === "local",
                    });
                  }}
                >
                  <Plug size={20} />
                  <span>
                    <b>{p.name}</b>
                    <small>{p.baseUrl}</small>
                  </span>
                  <small>Изменить ключ</small>
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void work("connect", async () => {
                const result = await post("/admin/providers", {
                  ...connection,
                  timeout: 120000,
                  concurrency: 1,
                  retries: 1,
                  isPrimary: true,
                });
                setProvider(result.id);
                setConnection({ ...connection, id: result.id, apiKey: "" });
                await post(`/admin/providers/${result.id}/models`);
                models.refresh();
                setStep(2);
                toast("Подключение сохранено, каталог загружен");
              });
            }}
          >
            <div className="form-grid">
              <Field label="Название подключения">
                <input
                  required
                  maxLength={80}
                  value={connection.name}
                  onChange={(e) =>
                    setConnection({ ...connection, name: e.target.value })
                  }
                />
              </Field>
              <Field label="Провайдер">
                <select
                  value={connection.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    setConnection({
                      ...connection,
                      type,
                      name:
                        type === "openrouter"
                          ? "OpenRouter"
                          : type === "local"
                            ? "Локальная модель"
                            : "Свой API",
                      baseUrl:
                        type === "openrouter"
                          ? "https://openrouter.ai/api/v1"
                          : type === "local"
                            ? "http://127.0.0.1:11434/v1"
                            : "",
                      trustedLocal: type === "local",
                    });
                  }}
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="compatible">Совместимый API</option>
                  <option value="local">Локальная модель</option>
                </select>
              </Field>
            </div>
            <Field label="Адрес API">
              <input
                required
                type="url"
                readOnly={connection.type === "openrouter"}
                value={connection.baseUrl}
                placeholder="https://example.com/v1"
                onChange={(e) =>
                  setConnection({ ...connection, baseUrl: e.target.value })
                }
              />
            </Field>
            <Field label="API-ключ">
              <input
                required={connection.type === "openrouter" && !connection.id}
                type="password"
                autoComplete="off"
                placeholder={
                  connection.id
                    ? "Оставьте пустым, чтобы сохранить существующий ключ"
                    : "Вставьте ключ из личного кабинета провайдера"
                }
                value={connection.apiKey}
                onChange={(e) =>
                  setConnection({ ...connection, apiKey: e.target.value })
                }
              />
            </Field>
            {connection.type !== "openrouter" && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={connection.trustedLocal}
                  onChange={(e) =>
                    setConnection({
                      ...connection,
                      trustedLocal: e.target.checked,
                    })
                  }
                />
                Разрешаю обращаться к моему локальному HTTP-серверу
              </label>
            )}
            <div className="notice">
              <KeyRound size={20} />
              <span>
                Для OpenRouter нужен собственный ключ и доступ к выбранной
                модели. Бесплатные модели тоже имеют ограничения частоты.
              </span>
            </div>
            <Button busy={busy === "connect"} className="primary">
              <Plug size={17} />
              Проверить и получить модели
              <ArrowRight size={16} />
            </Button>
            {connection.id && (
              <Button type="button" onClick={() => setStep(2)}>
                Продолжить с сохранённым подключением <ArrowRight size={16} />
              </Button>
            )}
          </form>
        </section>
      )}
      {step === 2 && (
        <section className="panel ai-step">
          <h2>2. Выберите одну модель для всех задач</h2>
          <p className="muted">
            Она будет создавать личности, писать сообщения, обновлять память и
            помогать с модерацией.
          </p>
          <div className="form-grid">
            <Field label="Подключение">
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel("");
                }}
              >
                <option value="">Выберите подключение</option>
                {v.providers.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Каталог">
              <Button
                type="button"
                disabled={!provider || !!busy}
                onClick={() =>
                  work("models", async () => {
                    await post(`/admin/providers/${provider}/models`);
                    models.refresh();
                  })
                }
              >
                <RefreshCw size={17} />
                Обновить модели
              </Button>
            </Field>
          </div>
          <ModelRecommendations
            onConnection={(baseUrl, name) => {
              setConnection({
                ...connection,
                id: undefined,
                trustedLocal: false,
                name,
                type: "compatible",
                baseUrl,
                apiKey: "",
              });
              setStep(1);
            }}
          />
          <div className="search-field">
            <Search size={18} />
            <input
              value={query}
              placeholder="Поиск по названию или ID модели…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <CatalogFilters
            models={models.value || []}
            provider={provider}
            selected={model}
            onSelect={(id, p) => {
              setModel(id);
              setProvider(p);
            }}
          />
          {selected && (
            <div className="selected-model">
              <Sparkles size={23} />
              <div>
                <b>{selected.name || selected.id}</b>
                <p>
                  Вход: {price(selected.pricing?.prompt)} · Выход:{" "}
                  {price(selected.pricing?.completion)}
                </p>
              </div>
            </div>
          )}
          <ModelEvaluation providerId={provider} modelId={model} />
          <h3>Безопасный старт</h3>
          <div className="form-grid">
            <Field label="Запросов в минуту">
              <select
                value={limits.rpm}
                onChange={(e) =>
                  setLimits({ ...limits, rpm: Number(e.target.value) })
                }
              >
                {[1, 2, 3, 6, 10, 20, 30, 60].map((n) => (
                  <option key={n} value={n}>
                    {n}
                    {n === 6 ? " — рекомендовано" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Максимум токенов ответа">
              <select
                value={limits.maxOutput}
                onChange={(e) =>
                  setLimits({ ...limits, maxOutput: Number(e.target.value) })
                }
              >
                {[2048, 4096, 8192].map((n) => (
                  <option key={n} value={n}>
                    {n}
                    {n === 4096
                      ? " — обычный старт"
                      : n === 8192
                        ? " — думающие модели"
                        : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Бюджет в день, USD">
              <input
                type="number"
                min="0.01"
                max="1000"
                step="0.01"
                value={limits.daily}
                onChange={(e) =>
                  setLimits({ ...limits, daily: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Бюджет в месяц, USD">
              <input
                type="number"
                min="0.01"
                max="10000"
                step="0.01"
                value={limits.monthly}
                onChange={(e) =>
                  setLimits({ ...limits, monthly: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <div className="notice">
            <Timer size={20} />
            <span>
              Запросы выполняются по очереди. HTTP 429 означает временное
              ожидание, а не потерю задания. Рассуждения модели не попадут в
              сообщения.
            </span>
          </div>
          <Button
            className="primary"
            disabled={!selected || !!busy}
            busy={busy === "assign"}
            onClick={() =>
              work("assign", async () => {
                await post("/admin/ai/use-model", {
                  providerId: provider,
                  modelId: model,
                  ...limits,
                });
                setTest(null);
                setStep(3);
              })
            }
          >
            Использовать для всех задач
            <ArrowRight size={17} />
          </Button>
        </section>
      )}
      {step === 3 && (
        <section className="panel ai-step">
          <h2>3. Проверьте настоящий ответ</h2>
          <p className="muted">
            Один платный запрос по выбранному тарифу. Профиль появится только
            здесь: аккаунт в сети не создаётся.
          </p>
          <div className="model-summary">
            <Sparkles />
            <div>
              <b>
                {v.selectedModel?.name ||
                  v.selectedModel?.id ||
                  "Модель ещё не выбрана"}
              </b>
              <small>Одна модель для всех пяти задач</small>
            </div>
          </div>
          <Button
            className="primary"
            disabled={!v.selectedModel || !!busy}
            busy={busy === "test"}
            onClick={() =>
              work("test", async () => setTest(await post("/admin/ai/test")))
            }
          >
            <Play size={17} />
            Проверить генерацию профиля
          </Button>
          {busy === "test" && (
            <p className="notice">
              Ожидаем окончательный ответ модели. Думающая модель может отвечать
              до двух минут. Не закрывайте вкладку и не запускайте повторную
              проверку.
            </p>
          )}
          {test && (
            <div className="test-profile">
              <Tag tone="green">
                <Check size={13} />
                Ответ получен и проверен
              </Tag>
              <h3>{test.profile.displayName}</h3>
              <small>@{test.profile.username}</small>
              <p>{test.profile.bio}</p>
              <p>{test.profile.interests.join(" · ")}</p>
              <span>
                Расход запроса: ${test.usage.cost.toFixed(6)} ·{" "}
                {test.usage.input + test.usage.output} токенов
              </span>
              <Button className="primary" onClick={() => setStep(4)}>
                Перейти к запуску
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
          <div className="notice">
            <Shield size={20} />
            <span>
              Если модель вернула только мысли или обрезанный JSON, вы увидите
              понятную причину. Вернитесь на шаг 2 и увеличьте лимит ответа либо
              смените модель.
            </span>
          </div>
        </section>
      )}
      {step === 4 && (
        <>
          <section className="panel ai-step">
            <div className="section-heading">
              <div>
                <h2>4. Запустите жизнь сети</h2>
                <p>
                  {v.selectedModel?.name || "Сначала выберите модель"} ·{" "}
                  {v.population} ИИ-участников создано
                </p>
              </div>
              <Users size={28} />
            </div>
            <Field label="Сколько ИИ-участников создать">
              <input
                type="number"
                min="1"
                max={Math.min(100, v.limits.maxAgents)}
                value={target}
                onChange={(e) => setTarget(Math.max(1, Number(e.target.value)))}
              />
              <small>
                Для первой проверки достаточно 3–5. Аккаунты появляются
                постепенно, после подтверждённых ответов модели.
              </small>
            </Field>
            <div className="button-row">
              <Button
                className="primary"
                disabled={!v.ready || !!busy}
                busy={busy === "start" || busy === "resume"}
                onClick={() =>
                  control(v.simulation.status === "paused" ? "resume" : "start")
                }
              >
                <Play size={17} />
                {v.simulation.status === "paused"
                  ? "Продолжить симуляцию"
                  : "Запустить симуляцию"}
              </Button>
              <Button
                disabled={v.simulation.status !== "running" || !!busy}
                onClick={() => control("pause")}
              >
                <Pause size={17} />
                Пауза
              </Button>
              <Button
                disabled={v.simulation.status === "stopped" || !!busy}
                onClick={() => control("stop")}
              >
                <Square size={16} />
                Остановить
              </Button>
            </div>
            {v.simulation.reason && (
              <div className="warning">{v.simulation.reason}</div>
            )}
            <div className="ai-status-grid">
              <div>
                <span>Создано участников</span>
                <strong>{v.population}</strong>
              </div>
              <div>
                <span>В очереди</span>
                <strong>
                  {v.counts.find((c: any) => c.status === "queued")?.count || 0}
                </strong>
              </div>
              <div>
                <span>Расход за день</span>
                <strong>${v.usage.daily.toFixed(4)}</strong>
              </div>
            </div>
            {jobs.some((j: any) => j.status === "failed") && (
              <div className="recovery-box">
                <RefreshCw size={23} />
                <div>
                  <b>Старые ошибки можно восстановить</b>
                  <p>
                    После исправления модели задания вернутся в очередь.
                    Повторные успешные задания не создадут копии сообщений.
                  </p>
                  <Button
                    busy={busy === "recover"}
                    onClick={() =>
                      work("recover", async () => {
                        const r = await post("/admin/ai/recover", {
                          resume: true,
                        });
                        toast(`Вернули в очередь: ${r.recovered}`);
                      })
                    }
                  >
                    Повторить ошибки и продолжить
                  </Button>
                </div>
              </div>
            )}
          </section>
          <section className="panel">
            <div className="section-heading">
              <h2>Очередь и состояние ИИ</h2>
              <Button onClick={state.refresh}>
                <RefreshCw size={16} />
                Обновить
              </Button>
            </div>
            {!jobs.length ? (
              <p className="muted">
                Заданий пока нет. Нажмите «Запустить симуляцию».
              </p>
            ) : (
              <div className="ai-jobs">
                {jobs.map((j: any) => (
                  <article key={j.id}>
                    <span className={"job-state " + j.status} />
                    <div>
                      <b>
                        {(
                          {
                            generate: "Создание участника",
                            reply: "Ответ в переписке",
                            activity: "Социальное действие",
                            planning: "Планирование",
                            memory: "Память",
                            forum_reply: "Ответ на форуме",
                            appeal: "Обжалование",
                          } as any
                        )[j.kind] || j.kind}
                      </b>
                      <p>
                        {j.status === "complete"
                          ? "Выполнено"
                          : j.status === "queued"
                            ? `В очереди · ${j.runAt > Date.now() ? "следующая попытка " + time(j.runAt, lang) : "ожидает обработки"}`
                            : j.status === "running"
                              ? "Выполняется…"
                              : "Требует исправления"}
                      </p>
                      {j.error && (
                        <details>
                          <summary>
                            {j.code === "PROVIDER_RATE_LIMIT" ||
                            j.code === "LOCAL_RATE_LIMIT" ||
                            j.code === "PROVIDER_COOLDOWN"
                              ? "Ожидание лимита запросов"
                              : "Причина и подробности"}
                          </summary>
                          <p>{j.error}</p>
                        </details>
                      )}
                    </div>
                    <Tag
                      tone={
                        j.status === "complete"
                          ? "green"
                          : j.status === "failed"
                            ? "red"
                            : ""
                      }
                    >
                      {j.status === "complete"
                        ? "Готово"
                        : j.status === "queued"
                          ? "Ожидание"
                          : j.status === "running"
                            ? "Работает"
                            : "Ошибка"}
                    </Tag>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
