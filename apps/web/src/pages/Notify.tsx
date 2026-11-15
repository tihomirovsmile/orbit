import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bell,
  LifeBuoy,
  Send,
  Paperclip,
  ShieldCheck,
} from "lucide-react";
import { api, post, patch } from "../services/api";
import {
  useApp,
  Button,
  Field,
  Modal,
  Loading,
  Tag,
  useLoad,
  Avatar,
} from "../components/UI";
import { Verified } from "../components/Crystal";
import {
  ticketStatusLabels,
  closedTicketStatuses,
} from "../../../../packages/shared/policy";
export function Countdown({
  at,
  serverNow,
}: {
  at: number;
  serverNow?: number;
}) {
  const [left, setLeft] = useState(Math.max(0, at - (serverNow || Date.now())));
  useEffect(() => {
    const start = Date.now(),
      base = serverNow || start;
    const t = setInterval(
      () => setLeft(Math.max(0, at - base - (Date.now() - start))),
      250,
    );
    return () => clearInterval(t);
  }, [at, serverNow]);
  return (
    <strong className="countdown" role="timer">
      {Math.floor(left / 60000)}:
      {String(Math.ceil(left / 1000) % 60).padStart(2, "0")}
    </strong>
  );
}
export function Notify({ onBack }: { onBack?: () => void }) {
  const { user, toast, refresh, setUser } = useApp(),
    data = useLoad<any>(() => api("/notify")),
    [ticket, setTicket] = useState<string | null>(null),
    [wizard, setWizard] = useState<any>(null),
    [help, setHelp] = useState<any>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) data.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (data.value?.events?.some((e: any) => !e.readAt))
      void post("/notify/ack", {
        ids: data.value.events
          .filter((e: any) => !e.readAt)
          .map((e: any) => e.id),
        read: true,
      }).catch(() => {});
  }, [data.value?.events?.length]);
  const act = async (path: string, body: any = {}) => {
    try {
      await post(path, body);
      data.refresh();
      refresh();
      const b = await api("/bootstrap");
      setUser(b.user);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const limited = ["banned", "deletion_pending"].includes(user.status);
  return (
    <section className="notify-page scroll">
      <header className="conversation-header">
        <button className="icon" onClick={onBack} aria-label="Назад">
          <ArrowLeft />
        </button>
        <Avatar name="Notify" src="/assets/status/notify.jpg" size={48} />
        <div>
          <h2>
            Notify <Verified value type="orbit" />
          </h2>
          <p>Системная служба Orbit · личные решения и поддержка</p>
        </div>
      </header>
      <div className="notify-content">
        <div className="notice">
          <ShieldCheck size={24} />
          <span>
            Это защищённая системная переписка. Поддержка не запрашивает пароли,
            ключи API и коды входа.
          </span>
        </div>
        {limited && (
          <article className="panel">
            <h2>
              {user.status === "deletion_pending"
                ? "Аккаунт ожидает удаления"
                : "Аккаунт заморожен"}
            </h2>
            <p>
              Здесь доступны решения, обращения и помощь. После отмены
              действующих ограничений обычные разделы вернутся.
            </p>
            {data.value?.deletionAt && (
              <>
                <Countdown
                  at={data.value.deletionAt}
                  serverNow={data.value.serverNow}
                />
                <Button onClick={() => act("/notify/cancel-deletion")}>
                  Отменить удаление аккаунта
                </Button>
              </>
            )}
          </article>
        )}
        <div className="button-row">
          <Button
            onClick={() => setWizard({ kind: limited ? "appeal" : "support" })}
          >
            <LifeBuoy size={17} />
            Новое обращение
          </Button>
          <Button
            onClick={() =>
              api("/notify/help")
                .then(setHelp)
                .catch((e) => toast(e.message))
            }
          >
            Правила и помощь
          </Button>
          {!limited && (
            <>
              <Button
                onClick={() =>
                  patch("/notify/preferences", {
                    muted: !data.value?.inbox?.muted,
                  })
                    .then(data.refresh)
                    .catch((e) => toast(e.message))
                }
              >
                {data.value?.inbox?.muted ? "Включить звук" : "Без звука"}
              </Button>
              <Button
                onClick={() =>
                  patch("/notify/preferences", { hidden: true })
                    .then(refresh)
                    .catch((e) => toast(e.message))
                }
              >
                Скрыть до важного события
              </Button>
            </>
          )}
        </div>
        {data.error && <p className="error">{data.error}</p>}
        {!data.value ? (
          <Loading />
        ) : (
          <>
            <div className="notify-events">
              {data.value.events.map((e: any) => (
                <article className={"notify-event " + e.importance} key={e.id}>
                  <small>{new Date(e.createdAt).toLocaleString()}</small>
                  <h3>{e.title}</h3>
                  <p>{e.body}</p>
                  {e.payload?.deleteAt && (
                    <Countdown
                      at={e.payload.deleteAt}
                      serverNow={data.value.serverNow}
                    />
                  )}
                  <div className="button-row">
                    {e.ticketId && (
                      <Button onClick={() => setTicket(e.ticketId)}>
                        Открыть обращение
                      </Button>
                    )}
                    {e.decisionId && (
                      <Button
                        onClick={() =>
                          setWizard({
                            kind: "appeal",
                            decisionId: e.decisionId,
                          })
                        }
                      >
                        Обжаловать решение
                      </Button>
                    )}
                    {e.kind === "CHANNEL_DELETION_STARTED" && (
                      <Button
                        onClick={() =>
                          act("/notify/cancel-channel-deletion", {
                            spaceId: e.objectId,
                          })
                        }
                      >
                        Отменить удаление
                      </Button>
                    )}
                    {e.payload?.acceptTransfer &&
                      ["accept", "reject"].map((action) => (
                        <Button
                          key={action}
                          onClick={() =>
                            act("/notify/transfers/" + e.payload.transferId, {
                              action,
                            })
                          }
                        >
                          {action === "accept"
                            ? "Принять владение"
                            : "Отклонить"}
                        </Button>
                      ))}
                    {e.payload?.cancelTransfer && (
                      <Button
                        onClick={() =>
                          act("/notify/transfers/" + e.payload.transferId, {
                            action: "cancel",
                          })
                        }
                      >
                        Отменить передачу
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <h3>Мои обращения</h3>
            {data.value.tickets.map((t: any) => (
              <button
                className="ticket-row"
                key={t.id}
                onClick={() => setTicket(t.id)}
              >
                <span>
                  {t.subject}
                  <small>№{t.id.slice(0, 8)}</small>
                </span>
                <Tag>{ticketStatusLabels[t.status] || t.status}</Tag>
              </button>
            ))}
            <details>
              <summary>
                Действующие решения ({data.value.decisions?.length || 0})
              </summary>
              {data.value.decisions?.map((d: any) => (
                <article key={d.id}>
                  <p>{d.reason}</p>
                  <Button
                    onClick={() =>
                      setWizard({ kind: "appeal", decisionId: d.id })
                    }
                  >
                    Обжаловать
                  </Button>
                </article>
              ))}
            </details>
          </>
        )}
      </div>
      {wizard && (
        <TicketWizard
          initial={wizard}
          decisions={(data.value?.decisions || []).filter((d: any) => d.active)}
          onClose={() => setWizard(null)}
          onDone={(id) => {
            setWizard(null);
            setTicket(id);
            data.refresh();
          }}
        />
      )}
      {ticket && (
        <TicketView
          id={ticket}
          onClose={() => {
            setTicket(null);
            data.refresh();
          }}
        />
      )}
      {help && (
        <Modal title={help.title} onClose={() => setHelp(null)}>
          {help.rules.map((r: string) => (
            <p key={r}>{r}</p>
          ))}
          <p>{help.support}</p>
        </Modal>
      )}
    </section>
  );
}
function Evidence({
  files,
  setFiles,
  staff = false,
}: {
  files: any[];
  setFiles: (f: any[]) => void;
  staff?: boolean;
}) {
  const { toast } = useApp(),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Field label="Доказательства / вложения">
        <input
          type="file"
          multiple
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            const out = [...files];
            try {
              for (const file of Array.from(e.target.files || [])) {
                if (out.length >= 10) throw new Error("Не более 10 файлов");
                const body = new FormData();
                body.append("file", file);
                out.push(
                  await api(staff ? "/media" : "/notify/media", {
                    method: "POST",
                    body,
                  }),
                );
              }
              setFiles(out);
            } catch (e) {
              toast((e as Error).message);
              setFiles(out);
            } finally {
              setBusy(false);
            }
          }}
        />
      </Field>
      <small>
        Фото до 3 МиБ каждое, суммарно 6 МиБ; видео до 800 МиБ; аудио до 100
        МиБ; документы до 25 МиБ. До 10 файлов.
      </small>
      {files.map((f) => (
        <div className="button-row" key={f.id}>
          <span>{f.name || f.original_name || f.id}</span>
          <Button
            type="button"
            onClick={() => setFiles(files.filter((x) => x.id !== f.id))}
          >
            Убрать
          </Button>
        </div>
      ))}
    </>
  );
}
export function TicketWizard({
  initial,
  decisions = [],
  onClose,
  onDone,
}: {
  initial: any;
  decisions?: any[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { user, toast } = useApp(),
    [kind, setKind] = useState(initial.kind || "support"),
    [step, setStep] = useState(1),
    [files, setFiles] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState<any>({
      subject: "",
      body: "",
      targetId: initial.targetId || "",
      decisionId: initial.decisionId || "",
      newEvidence: false,
    }),
    [key] = useState(() => crypto.randomUUID());
  const limited = ["banned", "deletion_pending"].includes(user.status);
  return (
    <Modal
      title={"Обращение в Notify · шаг " + step + " из 3"}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (step < 3) {
            setStep(step + 1);
            return;
          }
          setBusy(true);
          try {
            const r = await post("/notify/tickets", {
              ...form,
              kind,
              mediaIds: files.map((f) => f.id),
              requestKey: key,
              decisionId: form.decisionId || undefined,
              targetId: form.targetId || undefined,
              targetType: kind === "verification" ? "space" : undefined,
            });
            onDone(r.id);
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {step === 1 ? (
          <>
            <Field label="Тема обращения">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries({
                  support: "Помощь",
                  appeal: "Обжалование решения",
                  deletion: "Удаление аккаунта",
                  verification: "Проверка статуса сообщества",
                  data: "Мои данные",
                })
                  .filter(
                    ([k]) =>
                      !limited || ["appeal", "deletion", "data"].includes(k),
                  )
                  .map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </Field>
            {kind === "appeal" && (
              <Field label="Какое решение обжаловать">
                <select
                  required
                  value={form.decisionId}
                  onChange={(e) =>
                    setForm({ ...form, decisionId: e.target.value })
                  }
                >
                  <option value="">Выберите решение</option>
                  {decisions.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.reason || d.public_reason} · {d.targetType}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {kind === "verification" && (
              <Field label="ID вашего сообщества">
                <input
                  required
                  value={form.targetId}
                  onChange={(e) =>
                    setForm({ ...form, targetId: e.target.value })
                  }
                />
              </Field>
            )}
            {kind === "deletion" && (
              <p className="warning">
                Сначала передайте или удалите принадлежащие сообщества. Решение
                принимает владелец Orbit. После одобрения доступна отмена в
                течение часа.
              </p>
            )}
            <p>
              Одно обращение рассматривается активно; следующие ждут очереди.
              Срок ответа не гарантируется.
            </p>
          </>
        ) : step === 2 ? (
          <>
            <Field label="Краткая тема">
              <input
                required
                minLength={3}
                maxLength={120}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </Field>
            <Field label="Что произошло и что нужно пересмотреть">
              <textarea
                required
                minLength={10}
                maxLength={10000}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            </Field>
            <Evidence files={files} setFiles={setFiles} />
            {kind === "appeal" && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.newEvidence}
                  onChange={(e) =>
                    setForm({ ...form, newEvidence: e.target.checked })
                  }
                />
                Есть новые обстоятельства или доказательства для повторного
                обращения
              </label>
            )}
          </>
        ) : (
          <>
            <h3>{form.subject}</h3>
            <p className="preserve-text">{form.body}</p>
            <p>
              Вложений: {files.length}. Проверьте, что описание относится к
              выбранному объекту.
            </p>
            <label className="check">
              <input type="checkbox" required />
              Проверил описание, готов отправить
            </label>
          </>
        )}
        <div className="dialog-actions">
          {step > 1 && (
            <Button type="button" onClick={() => setStep(step - 1)}>
              Назад
            </Button>
          )}
          <Button className="primary" busy={busy}>
            {step === 3 ? "Отправить обращение" : "Продолжить"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function TicketView({
  id,
  onClose,
  staff = false,
}: {
  id: string;
  onClose: () => void;
  staff?: boolean;
}) {
  const { toast, user } = useApp(),
    prefix = staff ? "/admin/support/" : "/notify/tickets/",
    data = useLoad<any>(() => api(prefix + id), [id]),
    [body, setBody] = useState(""),
    [files, setFiles] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID()),
    [action, setAction] = useState("assign");
  const t = data.value;
  async function update(b: any) {
    setBusy(true);
    try {
      await patch(prefix + id, b);
      data.refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={"Обращение №" + id.slice(0, 8)} wide onClose={onClose}>
      {data.error ? (
        <p className="error">{data.error}</p>
      ) : !t ? (
        <Loading />
      ) : (
        <>
          <h3>{t.subject}</h3>
          <Tag>{ticketStatusLabels[t.status]}</Tag>
          {t.decision && (
            <div className="notice">
              <p>
                {t.decision.reason}
                <small>
                  {t.decision.active
                    ? "Решение действует"
                    : "Действие завершено"}
                </small>
              </p>
            </div>
          )}
          <div className="ticket-thread">
            {t.messages.map((m: any) => (
              <article key={m.id}>
                <b>
                  {m.authorType === "support" ? "Поддержка Orbit" : "Заявитель"}
                </b>
                <small>{new Date(m.createdAt).toLocaleString()}</small>
                <p className="preserve-text">{m.body}</p>
                {t.media
                  .filter((f: any) => f.messageId === m.id)
                  .map((f: any) => (
                    <a
                      key={f.id}
                      href={"/media/" + f.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {f.name} · {Math.ceil(f.size / 1024)} КиБ
                    </a>
                  ))}
              </article>
            ))}
          </div>
          {!closedTicketStatuses.includes(t.status) && (
            <>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await post(prefix + id + "/messages", {
                      body,
                      mediaIds: files.map((f) => f.id),
                      requestKey: key,
                    });
                    setBody("");
                    setFiles([]);
                    setKey(crypto.randomUUID());
                    data.refresh();
                  } catch (e) {
                    toast((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field
                  label={
                    staff ? "Ответ от поддержки Orbit" : "Дополнить обращение"
                  }
                >
                  <textarea
                    value={body}
                    required
                    maxLength={10000}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </Field>
                <Evidence files={files} setFiles={setFiles} staff={staff} />
                <Button busy={busy}>
                  <Send size={16} />
                  Отправить
                </Button>
              </form>
              {!staff && (
                <Button
                  onClick={() =>
                    post(prefix + id + "/withdraw")
                      .then(data.refresh)
                      .catch((e) => toast(e.message))
                  }
                >
                  Отозвать обращение
                </Button>
              )}
            </>
          )}
          {staff && !closedTicketStatuses.includes(t.status) && (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void update({
                  action,
                  reason: f.get("reason"),
                  verification:
                    t.kind === "verification" && action === "accepted"
                      ? {
                          type: f.get("type"),
                          categoryId: f.get("categoryId"),
                          country: f.get("country") || undefined,
                          evidence: f.get("evidence"),
                        }
                      : undefined,
                });
              }}
            >
              <Field label="Решение / работа с обращением">
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  {[
                    "assign",
                    "active",
                    "waiting_user",
                    "escalated",
                    "accepted",
                    "rejected",
                    "closed",
                  ].map((a) => (
                    <option key={a} value={a}>
                      {a === "assign"
                        ? "Взять в работу"
                        : ticketStatusLabels[a]}
                    </option>
                  ))}
                </select>
              </Field>
              {t.kind === "verification" && action === "accepted" && (
                <>
                  <Field label="Тип">
                    <select name="type">
                      <option value="standard">Подтверждено</option>
                      <option value="orbit">Orbit</option>
                    </select>
                  </Field>
                  <Field label="Категория">
                    <select name="categoryId">
                      <option value="blogger">Блогер</option>
                      <option value="company">Компания</option>
                      <option value="media">СМИ</option>
                    </select>
                  </Field>
                  <Field label="Страна финансирования (ISO, для СМИ)">
                    <input name="country" maxLength={2} />
                  </Field>
                  <Field label="Основание сведений">
                    <textarea name="evidence" />
                  </Field>
                </>
              )}
              <Field label="Понятное объяснение заявителю">
                <textarea
                  name="reason"
                  required={action !== "assign" && action !== "active"}
                  minLength={3}
                />
              </Field>
              <p className="muted">
                Принятие апелляции отменяет указанное решение. Удаление и
                верификацию утверждает только владелец Orbit.
              </p>
              <Button busy={busy}>Применить</Button>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
export function SupportDesk() {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [id, setId] = useState<string | null>(null),
    data = useLoad<any[]>(
      () =>
        api("/admin/support?q=" + encodeURIComponent(q) + "&status=" + status),
      [q, status],
    );
  return (
    <section className="panel">
      <h2>Поддержка · Notify</h2>
      <div className="form-grid">
        <Field label="Поиск">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Тема, имя или номер"
          />
        </Field>
        <Field label="Состояние">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Все</option>
            {Object.entries(ticketStatusLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {data.error && <p className="error">{data.error}</p>}
      {data.value?.map((t) => (
        <button
          className="ticket-row"
          key={t.id}
          onClick={() => {
            if (t.needsAssignment)
              patch("/admin/support/" + t.id, { action: "assign" })
                .then(() => setId(t.id))
                .catch(() => data.refresh());
            else setId(t.id);
          }}
        >
          <span>
            {t.subject}
            <small>
              {t.applicantName} · {t.kind}
            </small>
          </span>
          <Tag>{ticketStatusLabels[t.status]}</Tag>
        </button>
      ))}
      {data.value?.length === 0 && <p>Обращений пока нет.</p>}
      {id && (
        <TicketView
          id={id}
          staff
          onClose={() => {
            setId(null);
            data.refresh();
          }}
        />
      )}
    </section>
  );
}
