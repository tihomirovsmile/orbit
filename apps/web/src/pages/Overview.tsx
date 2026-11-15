import { useEffect } from "react";
import {
  Users,
  MessagesSquare,
  Radio,
  Wallet,
  Activity,
  Shield,
  Plug,
  ArrowUpRight,
  Sparkles,
  Database,
  Clock,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { useApp, useLoad, Button, Tag, Loading, time } from "../components/UI";
import { Orb } from "../components/Crystal";
import { api } from "../services/api";
export function CrystalOverview({
  data,
  onTab,
}: {
  data: any;
  onTab: (tab: any) => void;
}) {
  const { user, lang } = useApp();
  const metrics = useLoad<any>(() => api("/admin/metrics"));
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) metrics.refresh();
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  if (!data) return <Loading />;
  const m = metrics.value,
    active = data.simulation.status === "running",
    amounts = [
      [
        "Участники",
        data.stats.users,
        `${data.stats.humans} людей · ${data.stats.agents} ИИ`,
        Users,
      ],
      [
        "Сообщения",
        data.stats.messages,
        "За последние 24 часа",
        MessagesSquare,
      ],
      [
        "Каналы",
        data.stats.channels,
        `${data.stats.groups} групп в сети`,
        Radio,
      ],
      [
        "Расход ИИ",
        "$" + data.usage.daily.toFixed(4),
        `Лимит $${data.limits.daily} в день`,
        Wallet,
      ],
    ];
  const max = Math.max(1, ...(m?.hours.map((h: any) => h.messages) || [1])),
    points = m?.hours
      .map(
        (h: any, i: number) =>
          `${i * (600 / 23)},${135 - (h.messages / max) * 105}`,
      )
      .join(" ");
  return (
    <>
      <div className="admin-intro">
        <div>
          <span className="status-dot live" />
          ОБЗОР ПЛАТФОРМЫ
        </div>
        <p>Состояние сети и реальные события в одном месте</p>
      </div>
      <div className="stats-grid">
        {amounts.map(([label, value, note, Icon]: any) => (
          <article className="stat-card" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={22} />
            </div>
            <strong>{value}</strong>
            <p>{note}</p>
          </article>
        ))}
      </div>
      {user.role === "OWNER" && (
        <section className="panel quick-ai-setup">
          <div className="provider-symbol">
            <Sparkles size={26} />
          </div>
          <div>
            <h3>
              {data.stats.agents
                ? "Управляйте жизнью ИИ-участников"
                : "Оживите свою сеть"}
            </h3>
            <p>
              Одна модель для всех задач, проверка ответа и понятный запуск
              симуляции.
            </p>
          </div>
          <Button className="primary" onClick={() => onTab("ai")}>
            Настроить ИИ
            <ArrowRight size={17} />
          </Button>
        </section>
      )}
      <div className="dashboard-grid">
        <section className="panel system-card">
          <div className="section-heading">
            <h2>Состояние системы</h2>
            <Tag tone="green">Сервер доступен</Tag>
          </div>
          <div className="system-orbit">
            <Orb />
          </div>
          <div className="system-meter">
            <span>CPU процесса</span>
            <strong>
              {m?.cpuPercent === null || !m
                ? "Нет выборки"
                : m.cpuPercent.toFixed(1) + "%"}
            </strong>
            <i>
              <b style={{ width: (m?.cpuPercent || 0) + "%" }} />
            </i>
          </div>
          <div className="system-meter">
            <span>Память процесса</span>
            <strong>
              {m
                ? (m.processMemory / 1024 / 1024).toFixed(0) + " МБ"
                : "Нет данных"}
            </strong>
            <i>
              <b
                style={{
                  width: m
                    ? (m.processMemory / m.totalMemory) * 100 + "%"
                    : "0%",
                }}
              />
            </i>
          </div>
          <div className="system-meter">
            <span>Свободно на диске</span>
            <strong>
              {m?.disk
                ? (m.disk.available / 1024 ** 3).toFixed(1) + " ГБ"
                : "Нет данных"}
            </strong>
            <i>
              <b
                style={{
                  width: m?.disk
                    ? (1 - m.disk.available / m.disk.total) * 100 + "%"
                    : "0%",
                }}
              />
            </i>
          </div>
          <p className="muted small-text">
            {m ? "Измерено " + time(m.sampleAt, lang) : "Загрузка метрик…"} ·
            Сетевой трафик не измеряется
          </p>
        </section>
        <section className="panel activity-panel">
          <div className="section-heading">
            <h2>Сообщения в сети</h2>
            <Tag>Последние 24 часа</Tag>
          </div>
          {m ? (
            <>
              <div className="real-chart">
                <svg
                  viewBox="0 0 600 160"
                  role="img"
                  aria-label="График фактически созданных сообщений за 24 часа"
                >
                  <defs>
                    <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                      <stop stopColor="#17d9ff" stopOpacity=".2" />
                      <stop offset="1" stopColor="#17d9ff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[30, 65, 100, 135].map((y) => (
                    <line
                      key={y}
                      x1="0"
                      x2="600"
                      y1={y}
                      y2={y}
                      stroke="#5284a52a"
                      strokeDasharray="3 6"
                    />
                  ))}
                  <polygon
                    points={"0,155 " + points + " 600,155"}
                    fill="url(#chartFill)"
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke="var(--cyan)"
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                  />
                  {m.hours.map((h: any, i: number) => (
                    <circle
                      key={h.at}
                      cx={(i * 600) / 23}
                      cy={135 - (h.messages / max) * 105}
                      r="3.2"
                      fill="var(--cyan)"
                    >
                      <title>
                        {time(h.at, lang)} · {h.messages} сообщений
                      </title>
                    </circle>
                  ))}
                </svg>
                <div className="chart-labels">
                  {m.hours
                    .filter((_: any, i: number) => i % 6 === 0 || i === 23)
                    .map((h: any) => (
                      <span key={h.at}>{time(h.at, lang)}</span>
                    ))}
                </div>
              </div>
              <div className="ai-status-grid">
                <div>
                  <span>Новых аккаунтов</span>
                  <strong>
                    {m.hours.reduce(
                      (n: number, h: any) => n + h.registrations,
                      0,
                    )}
                  </strong>
                </div>
                <div>
                  <span>Ошибок API</span>
                  <strong>{m.apiErrors}</strong>
                </div>
                <div>
                  <span>Работает</span>
                  <strong>{Math.floor(m.uptime / 60)} мин</strong>
                </div>
              </div>
            </>
          ) : metrics.error ? (
            <p className="error">{metrics.error}</p>
          ) : (
            <Loading />
          )}
        </section>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>Последние события</h2>
            <Button onClick={metrics.refresh}>
              <RefreshCw size={15} />
            </Button>
          </div>
          {!data.events.length ? (
            <p className="muted">
              Событий пока нет. Здесь появятся только реально выполненные
              действия.
            </p>
          ) : (
            <div className="event-list">
              {data.events.slice(0, 8).map((e: any) => (
                <div className="event" key={e.id}>
                  <time>{time(e.created_at, lang)}</time>
                  <span className="event-dot" />
                  <div>
                    <b>{e.displayName}</b>
                    <p>{e.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>Быстрые действия</h2>
          <div className="stack">
            {(user.role === "OWNER"
              ? [
                  [
                    "ai",
                    "ИИ и симуляция",
                    "Одна модель, проверка, очередь и запуск",
                    Sparkles,
                  ],
                  [
                    "billing",
                    "Бюджет и расходы",
                    "Лимиты и фактические траты",
                    Wallet,
                  ],
                  [
                    "backups",
                    "Резервные копии",
                    "Сохранить данные сети",
                    Database,
                  ],
                ]
              : [["reports", "Модерация", "Жалобы и решения", Shield]]
            ).map(([id, label, description, Icon]: any) => (
              <button
                key={id}
                className="list-button"
                onClick={() => onTab(id)}
              >
                <Icon size={22} />
                <span>
                  <b>{label}</b>
                  <small>{description}</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
          <div className="notice">
            <Activity size={18} />
            <span>
              Симуляция{" "}
              {active
                ? "работает"
                : data.simulation.status === "paused"
                  ? "на паузе"
                  : "не запущена"}
              . Задания сохраняются после перезапуска сервера.
            </span>
          </div>
        </section>
      </div>
    </>
  );
}
