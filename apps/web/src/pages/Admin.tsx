import { Policies } from "./Policies";
import { Governance, AuditLog, ReportsDesk } from "./Governance";
import { SupportDesk } from "./Notify";
import { PersonaEditor } from "./PersonaEditor";
import { askText, askConfirm } from "../components/dialogs";
import { useEffect, useState } from "react";
import {
  Activity,
  Users,
  Radio,
  MessagesSquare,
  ArrowUpRight,
  Play,
  Pause,
  Square,
  RefreshCw,
  Plus,
  Check,
  ExternalLink,
  Database,
  Download,
  KeyRound,
  Search,
  Shield,
  Settings,
  Sparkles,
  ArrowRight,
  Wallet,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { api, post, patch, put } from "../services/api";
import {
  useApp,
  Avatar,
  Button,
  Field,
  Modal,
  Tag,
  Loading,
  Empty,
  time,
  date,
  useLoad,
} from "../components/UI";
import { languageNames } from "../i18n";
import { MediaLibrary } from "./MediaLibrary";
import { AIHub } from "./AIHub";
import { CrystalOverview } from "./Overview";
import { Verified } from "../components/Crystal";
const actionLabels: Record<string, string> = {
  warn: "Предупредить",
  ban: "Заблокировать",
  unban: "Разблокировать",
  restrict: "Ограничить",
  verify: "Выдать галочку",
  unverify: "Снять галочку",
  pause: "Приостановить",
  resume: "Продолжить",
  delete: "Удалить",
  role: "Изменить роль",
  freeze: "Заморозить",
  unfreeze: "Разморозить",
  transfer: "Передать владельцу",
  "comments-off": "Отключить комментарии",
  direct: "Написать собеседнику",
  create_channel: "Создать канал",
  create_group: "Создать группу",
  post: "Опубликовать пост",
  subscribe: "Подписаться",
  unsubscribe: "Отписаться",
  avatar: "Обновить аватар",
  leave: "Покинуть сообщество",
  topic: "Создать тему на форуме",
  edit: "Изменить сообщение",
};
const tabs = [
  "overview",
  "support",
  "personas",
  "ai",
  "users",
  "spaces",
  "billing",
  "media",
  "reports",
  "audit",
  "network",
  "backups",
] as const;
export function Admin() {
  const { t, user } = useApp();
  const [tab, setTab] = useState<(typeof tabs)[number]>("overview");
  const overview = useLoad<any>(() => api("/admin/overview"));
  useEffect(() => {
    const handle = setInterval(overview.refresh, 5000);
    return () => clearInterval(handle);
  }, []);
  const owner = user.role === "OWNER";
  return (
    <div className="admin-page">
      <header className="admin-header">
        <div>
          <span className="eyebrow">ORBIT / УПРАВЛЕНИЕ</span>
          <h1>
            {t("admin")}
            <span className="accent-period">.</span>
          </h1>
        </div>
        <div className="admin-state">
          <span
            className={`status-dot ${overview.value?.simulation.status === "running" ? "live" : ""}`}
          />
          {t(overview.value?.simulation.status || "stopped")}
          <Tag>
            {user.role === "OWNER"
              ? "Владелец"
              : user.role === "ADMIN"
                ? "Администратор"
                : "Модератор"}
          </Tag>
        </div>
      </header>
      <div className="admin-tabs">
        {tabs
          .filter(
            (k) =>
              owner ||
              [
                "overview",
                "users",
                "spaces",
                "reports",
                "audit",
                "support",
                ...((user as any).permissions?.createPersonas
                  ? ["personas"]
                  : []),
                ...((user as any).permissions?.manageAi ? ["ai"] : []),
              ].includes(k),
          )
          .filter((k) => !["providers", "models", "simulation"].includes(k))
          .map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={tab === k ? "active" : ""}
            >
              {k === "support"
                ? "Поддержка"
                : k === "personas"
                  ? "Личности"
                  : k === "media"
                    ? "Медиатека"
                    : k === "ai"
                      ? "ИИ и симуляция"
                      : t(k)}
            </button>
          ))}
      </div>
      <div className="admin-body scroll">
        {overview.error && <p className="error">{overview.error}</p>}
        {tab === "support" ? (
          <SupportDesk />
        ) : tab === "personas" ? (
          <PersonaEditor />
        ) : tab === "reports" ? (
          <ReportsDesk />
        ) : tab === "audit" ? (
          <AuditLog />
        ) : tab === "ai" ? (
          <AIHub />
        ) : tab === "media" ? (
          <MediaLibrary />
        ) : tab === "overview" ? (
          <CrystalOverview data={overview.value} onTab={setTab} />
        ) : tab === "billing" ? (
          <Billing />
        ) : tab === "users" ? (
          <Governance type="user" />
        ) : tab === "spaces" ? (
          <Governance type="space" />
        ) : tab === "network" ? (
          <NetworkSettings />
        ) : tab === "backups" ? (
          <Backups />
        ) : (
          <Empty title="Выберите раздел" />
        )}
      </div>
    </div>
  );
}
function Billing() {
  const { t, toast } = useApp();
  const { value, refresh } = useLoad<any>(() => api("/admin/billing"));
  const { value: models } = useLoad<any[]>(() => api("/admin/models"));
  const [modelId, setModelId] = useState(""),
    [active, setActive] = useState(10),
    [calls, setCalls] = useState(5);
  const model = models?.find((m) => m.id === modelId),
    pricing = model?.pricing;
  const estimate =
    pricing?.prompt !== undefined && pricing?.completion !== undefined
      ? active *
        calls *
        (1500 * Number(pricing.prompt) +
          150 * Number(pricing.completion) +
          (Number(pricing.request) || 0))
      : null;
  const labels: Record<string, string> = {
    daily: t("daily"),
    monthly: t("monthly"),
    maxAgents: "Максимум ИИ-аккаунтов",
    maxАктивно: "Параллельные задания",
    rpm: "Запросов в минуту",
    agentTokens: "Токенов на личность за сутки UTC",
    maxGenerations: "Генераций в день (UTC)",
    maxOutput: "Максимум токенов ответа",
    unknownPriceReserve: "Резерв для запроса без тарифа, USD",
  };
  return !value ? (
    <Loading />
  ) : (
    <>
      <div className="stats-grid">
        <article className="stat-card">
          <span>Фактический расход ИИ</span>
          <strong>${value.totals.cost.toFixed(5)}</strong>
          <p>+ ${value.totals.reserved.toFixed(5)} reserved</p>
        </article>
        <article className="stat-card">
          <span>День / месяц (UTC)</span>
          <strong>${value.totals.daily.toFixed(4)}</strong>
          <p>${value.totals.monthly.toFixed(4)} this month</p>
        </article>
        <article className="stat-card">
          <span>Tokens</span>
          <strong>
            {(
              value.totals.inputTokens + value.totals.outputTokens
            ).toLocaleString()}
          </strong>
          <p>
            {value.totals.inputTokens} in · {value.totals.outputTokens} out
          </p>
        </article>
        <article className="stat-card">
          <span>Среднее на запрос</span>
          <strong>
            $
            {(value.totals.cost / Math.max(1, value.totals.requests)).toFixed(
              5,
            )}
          </strong>
          <p>{value.totals.requests} requests</p>
        </article>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <h2>{t("budget")}</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await put(
                  "/admin/limits",
                  Object.fromEntries([...f].map(([k, v]) => [k, Number(v)])),
                );
                refresh();
                toast(t("save"));
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            <div className="form-grid">
              {Object.entries(value.limits).map(([key, v]) => (
                <Field key={key} label={labels[key] || key}>
                  <input
                    type="number"
                    step={
                      ["daily", "monthly", "unknownPriceReserve"].includes(key)
                        ? "0.001"
                        : "1"
                    }
                    min={
                      key === "unknownPriceReserve"
                        ? 0.001
                        : ["maxАктивно", "rpm"].includes(key)
                          ? 1
                          : key === "maxOutput"
                            ? 50
                            : 0
                    }
                    name={key}
                    required
                    defaultValue={v as number}
                  />
                </Field>
              ))}
            </div>
            <Button className="primary">{t("save")}</Button>
          </form>
        </section>
        <section className="panel">
          <h2>Калькулятор расходов</h2>
          <Field label={t("model")}>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              <option value="">{t("model")}</option>
              {models?.map((m) => (
                <option key={m.providerId + m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Активных ИИ">
            <input
              type="number"
              min="0"
              max="10000"
              value={active}
              onChange={(e) => setActive(Number(e.target.value))}
            />
          </Field>
          <Field label="Интенсивность общения">
            <select
              value={calls}
              onChange={(e) => setCalls(Number(e.target.value))}
            >
              {[
                [1, "Minimal"],
                [5, "Moderate"],
                [20, "High"],
                [60, "Very high"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l} · {v} calls / agent / day
                </option>
              ))}
            </select>
          </Field>
          <div className="cost-estimate">
            <span>Прогноз на день</span>
            <strong>
              {estimate === null ? "—" : `$${estimate.toFixed(4)}`}
            </strong>
            <span>
              Прогноз на 30 дней ·{" "}
              {estimate === null ? "—" : `$${(estimate * 30).toFixed(3)}`}
            </span>
          </div>
          <p className="muted small-text">
            Расчёт использует 1500 входных и 150 выходных токенов на запрос. Это
            оценка, фактическая цена зависит от модели и длины ответов. Если
            тариф неизвестен, стоимость не выдумывается. При обрыве соединения
            резерв учитывается консервативно до сверки с провайдером.
          </p>
        </section>
      </div>
      <section className="panel">
        <h2>Журнал запросов ИИ</h2>
        <div className="data-table">
          <table>
            <thead>
              <tr>
                <th>Модель / задача</th>
                <th>Токены входа / ответа</th>
                <th>USD</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {value.usage.map((u: any) => (
                <tr key={u.id}>
                  <td>
                    {u.model_id}
                    <small>{u.task}</small>
                  </td>
                  <td>
                    {u.input_tokens} / {u.output_tokens}
                  </td>
                  <td>{u.cost.toFixed(6)}</td>
                  <td>
                    <Tag tone={u.status === "error" ? "red" : ""}>
                      {u.status}
                    </Tag>
                    {u.error && <small>{u.error}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function NetworkSettings() {
  const { t, toast } = useApp();
  const { value } = useLoad<any>(() => api("/admin/settings"));
  return !value ? (
    <Loading />
  ) : (
    <section className="panel network-settings">
      <h2>{t("network")}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await put("/admin/settings", {
              ...Object.fromEntries(f),
              registration: f.get("registration") === "on",
              maxHumans: Number(f.get("maxHumans")),
            });
            toast(t("save"));
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      >
        <Field label={t("title")}>
          <input
            required
            name="name"
            defaultValue={value.network.name || "Orbit"}
          />
        </Field>
        <Field label={t("description")}>
          <textarea
            name="description"
            defaultValue={value.network.description || ""}
          />
        </Field>
        <Field label="Логотип — адрес загруженного файла /media/id">
          <input name="logo" defaultValue={value.network.logo || ""} />
        </Field>
        <Field label={t("language")}>
          <select name="language" defaultValue={value.network.language || "ru"}>
            {Object.entries(languageNames).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Часовой пояс IANA, например Europe/Kyiv">
          <input
            name="timezone"
            required
            defaultValue={value.network.timezone || "Europe/Kyiv"}
          />
        </Field>
        <Field label="Режим доступа">
          <select
            name="access"
            defaultValue={value.network.access || "localhost"}
          >
            <option value="localhost">Localhost</option>
            <option value="lan">Local network</option>
            <option value="external">External server</option>
          </select>
        </Field>
        <Field label="Максимум людей (0 — без ограничения)">
          <input
            type="number"
            name="maxHumans"
            min="0"
            defaultValue={value.network.maxHumans || 0}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            name="registration"
            defaultChecked={value.network.registration !== false}
          />
          {t("register")}
        </label>
        <p className="warning">
          Для доступа из интернета нужны HTTPS, защищённые cookies и настройка
          сервера. Для домашней сети выберите сетевой режим запуска.
        </p>
        <Button className="primary">{t("save")}</Button>
      </form>
      <Policies />
      <RuntimeSettings />
    </section>
  );
}
function RuntimeSettings() {
  const { t, toast } = useApp();
  const { value, refresh } = useLoad<any>(() => api("/admin/runtime"));
  const desktop = useLoad<any>(() => api("/desktop"));
  if (desktop.value?.available)
    return (
      <p className="muted">
        Режим запуска настольной версии меняется в настройках приложения.
      </p>
    );
  if (!value) return <Loading />;
  const config = value.pending || value.active;
  return (
    <details>
      <summary>Порт, интерфейс и папка данных</summary>
      <p className="warning">
        Настройки сохраняются для следующего запуска. При изменении папки данных
        будет открыта другая база. Для переноса сначала скопируйте всю текущую
        папку storage.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await put("/admin/runtime", {
              host: f.get("host"),
              port: Number(f.get("port")),
              dataDir: f.get("dataDir"),
              publicOrigin: f.get("publicOrigin"),
              secureCookie: f.get("secureCookie") === "on",
            });
            toast("Сохранено. Для применения перезапустите сервер.");
            refresh();
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Сетевой адрес (127.0.0.1 или 0.0.0.0)">
            <input name="host" required defaultValue={config.host} />
          </Field>
          <Field label="Порт HTTP">
            <input
              name="port"
              type="number"
              min="1"
              max="65535"
              required
              defaultValue={config.port}
            />
          </Field>
        </div>
        <Field label="Папка данных">
          <input name="dataDir" required defaultValue={config.dataDir} />
        </Field>
        <Field label="Публичный адрес (HTTPS для интернета)">
          <input
            name="publicOrigin"
            type="url"
            defaultValue={config.publicOrigin}
          />
        </Field>
        <label className="check">
          <input
            name="secureCookie"
            type="checkbox"
            defaultChecked={config.secureCookie}
          />
          Защищённые cookies для HTTPS
        </label>
        <label className="check">
          <input type="checkbox" required />Я понимаю, что адрес, порт и папка
          данных изменятся только после перезапуска.
        </label>
        <p className="muted small-text">{value.precedence}</p>
        <Button className="primary">{t("save")} · нужен перезапуск</Button>
      </form>
    </details>
  );
}
function Backups() {
  const { t, toast } = useApp();
  const { value, refresh } = useLoad<string[]>(() => api("/admin/backups"));
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>
          <Database size={20} />
          {t("backups")}
        </h2>
        <Button
          busy={busy}
          className="primary"
          onClick={async () => {
            setBusy(true);
            try {
              await post("/admin/backup");
              refresh();
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Plus size={16} />
          Создать резервную копию базы
        </Button>
      </div>
      <p className="warning">
        Резервная копия содержит личные данные и зашифрованные ключи. Для
        полного восстановления сохраните также папку storage с медиа и файлом
        ключа. Восстановление выполняется при остановленном сервере — инструкция
        в README.md.
      </p>
      <div className="stack">
        {value?.map((name) => (
          <a
            key={name}
            href={`/api/admin/backups/${name}`}
            className="backup-row"
            download
          >
            <Database size={18} />
            {name}
            <Download size={18} />
          </a>
        ))}
      </div>
      <a className="btn" href="/api/admin/export" download>
        <Download size={17} />
        Скачать публичные сообщества и профили (JSON)
      </a>
      <p className="muted">
        Медиа и ключ шифрования хранятся отдельно от базы. Инструкция по
        восстановлению — в README.md.
      </p>
    </section>
  );
}
