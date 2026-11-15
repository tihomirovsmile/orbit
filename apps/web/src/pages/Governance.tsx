import { BulkActions } from "./BulkActions";
import { useState } from "react";
import { api, post, patch } from "../services/api";
import {
  Avatar,
  Button,
  Field,
  Modal,
  Tag,
  useApp,
  useLoad,
  Loading,
} from "../components/UI";
import { StatusIcons } from "../components/Crystal";
import { reasonLabels } from "../../../../packages/shared/policy";
export function Governance({ type }: { type: "user" | "space" }) {
  const { user, toast } = useApp(),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [picked, setPicked] = useState<string[]>([]),
    [bulk, setBulk] = useState(false),
    data = useLoad<any[]>(
      () => api("/admin/governance/" + (type === "user" ? "users" : "spaces")),
      [type],
    );
  return (
    <section className="panel">
      <h2>{type === "user" ? "Аккаунты" : "Сообщества"}</h2>
      <Field label="Поиск">
        <input
          placeholder="Имя или адрес"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Field>
      {data.error && <p className="error">{data.error}</p>}
      {type === "user" && (
        <div className="bulk-toolbar">
          <Button
            onClick={() =>
              setPicked(
                (data.value || [])
                  .filter(
                    (x) =>
                      x.role !== "OWNER" &&
                      (user.role !== "MODERATOR" ||
                        !["ADMIN", "MODERATOR"].includes(x.role)) &&
                      ((x.displayName || "") + " " + x.username)
                        .toLowerCase()
                        .includes(q.toLowerCase()),
                  )
                  .slice(0, 100)
                  .map((x) => x.id),
              )
            }
          >
            Выбрать найденных (до 100)
          </Button>
          <span>Выбрано: {picked.length}</span>
          <Button disabled={!picked.length} onClick={() => setBulk(true)}>
            Массовое действие
          </Button>
          <Button disabled={!picked.length} onClick={() => setPicked([])}>
            Снять выбор
          </Button>
        </div>
      )}
      {bulk && (
        <BulkActions
          targets={(data.value || []).filter((x) => picked.includes(x.id))}
          onClose={() => setBulk(false)}
          onDone={() => {
            setBulk(false);
            setPicked([]);
            data.refresh();
          }}
        />
      )}
      <div className="governance-list">
        {data.value
          ?.filter((x) =>
            ((x.displayName || x.title) + " " + x.username + " " + x.slug)
              .toLowerCase()
              .includes(q.toLowerCase()),
          )
          .map((x) => (
            <article key={x.id}>
              {type === "user" && (
                <input
                  className="bulk-pick"
                  type="checkbox"
                  aria-label={"Выбрать " + x.displayName}
                  disabled={
                    x.role === "OWNER" ||
                    (user.role === "MODERATOR" &&
                      ["ADMIN", "MODERATOR"].includes(x.role)) ||
                    (!picked.includes(x.id) && picked.length >= 100)
                  }
                  checked={picked.includes(x.id)}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked
                        ? [...picked, x.id]
                        : picked.filter((id) => id !== x.id),
                    )
                  }
                />
              )}
              <Avatar name={x.displayName || x.title} src={x.avatar} />
              <span>
                <b>{x.displayName || x.title}</b>
                <StatusIcons item={x} targetType={type} />
                <small>
                  @{x.username || x.slug} ·{" "}
                  {x.status || (x.frozen ? "Заморожено" : "Активно")}
                  {x.ownerName ? " · владелец: " + x.ownerName : ""}
                </small>
                {x.publicDisplayName === "DELETED" && (
                  <small>Публичное имя: DELETED</small>
                )}
              </span>
              <Button
                disabled={x.role === "OWNER"}
                onClick={() => setSelected(x)}
              >
                Действия
              </Button>
            </article>
          ))}
      </div>
      {selected && (
        <ActionDialog
          target={selected}
          type={type}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            data.refresh();
          }}
        />
      )}
      {type === "space" && user.role === "OWNER" && <VerificationCategories />}
    </section>
  );
}
function ActionDialog({
  target,
  type,
  onClose,
  onDone,
}: {
  target: any;
  type: "user" | "space";
  onClose: () => void;
  onDone: () => void;
}) {
  const { user, toast } = useApp(),
    [action, setAction] = useState("freeze"),
    [review, setReview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [category, setCategory] = useState("blogger"),
    [verifyType, setVerifyType] = useState("standard"),
    preview = useLoad<any>(
      () =>
        api(
          "/admin/actions/preview?" +
            new URLSearchParams({
              targetType: type,
              targetId: target.id,
              action,
            }),
        ),
      [target.id, action],
    ),
    categories = useLoad<any[]>(() => api("/verification/categories"));
  const owner = user.role === "OWNER",
    names: any =
      type === "space"
        ? {
            freeze: "Заморозка",
            restore: "Отмена конкретного решения",
            verification: target.verified
              ? "Отозвать подтверждённый статус"
              : "Выдать подтверждённый статус",
          }
        : {
            freeze: "Заморозка аккаунта",
            restore: "Отмена конкретного решения",
            warn: "Предупреждение",
            restrict: "Ограничение отправки",
            propose_deletion: "Предложить удаление владельцу",
            ...(owner
              ? {
                  approve_deletion: "Одобрить удаление аккаунта",
                  role: "Роль и полномочия",
                }
              : {}),
            ...(owner && target.type === "ai"
              ? { ai_pause: "Приостановить ИИ", ai_resume: "Продолжить ИИ" }
              : {}),
          };
  if (type === "space" && !owner) delete names.verification;
  return (
    <Modal
      title={"Действия · " + (target.displayName || target.title)}
      wide
      onClose={onClose}
    >
      {review ? (
        <>
          <h3>Предпросмотр: {names[action]}</h3>
          <p>Объект: {target.displayName || target.title}</p>
          <p>Причина: {review.reason}</p>
          {["freeze", "restrict"].includes(action) && (
            <p>
              Срок:{" "}
              {review.durationHours
                ? review.durationHours + " ч."
                : "до ручного пересмотра"}
              .{" "}
              {type === "user" && action === "freeze"
                ? "Оформление скрывается, принадлежащие сообщества наследуют заморозку."
                : ""}
            </p>
          )}
          {action === "verification" && (
            <p>
              {target.verified
                ? "Статус сообщества будет отозван."
                : "Выдаётся статус " +
                  (verifyType === "orbit"
                    ? "Orbit"
                    : categories.value?.find((x) => x.id === category)
                        ?.name)}{" "}
              Производная отметка владельца пересчитывается автоматически.
            </p>
          )}
          {action === "approve_deletion" && (
            <p className="warning">
              После подтверждения аккаунт ожидает удаления один час. В течение
              часа пользователь может отменить его в Notify. Принадлежащие
              сообщества должны быть переданы или удалены.
            </p>
          )}
          {preview.value?.communities?.length > 0 && (
            <p>
              Связанные сообщества:{" "}
              {preview.value.communities.map((s: any) => s.title).join(", ")}
            </p>
          )}
          <div className="dialog-actions">
            <Button onClick={() => setReview(null)}>Изменить</Button>
            <Button
              className="primary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post("/admin/actions", review);
                  onDone();
                } catch (e) {
                  toast((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Подтвердить действие
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              b: any = {
                targetType: type,
                targetId: target.id,
                action,
                reason: f.get("reason"),
                reasonCode: f.get("reasonCode") || "other",
              };
            if (f.get("durationHours"))
              b.durationHours = Number(f.get("durationHours"));
            if (action === "restore") b.decisionId = f.get("decisionId");
            if (action === "role") {
              b.role = f.get("role");
              b.permissions = {
                manageAi: f.get("manageAi") === "on",
                createPersonas: f.get("createPersonas") === "on",
              };
            }
            if (action === "verification")
              b.verification = {
                action: target.verified ? "revoke" : "grant",
                type: verifyType,
                categoryId: category,
                country: f.get("country") || undefined,
                evidence: f.get("evidence") || undefined,
              };
            setReview(b);
          }}
        >
          <Field label="Действие">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {Object.entries(names).map(([k, v]) => (
                <option key={k} value={k}>
                  {v as string}
                </option>
              ))}
            </select>
          </Field>
          {["freeze", "warn", "restrict"].includes(action) && (
            <>
              <Field label="Фиксированная причина">
                <select name="reasonCode" defaultValue="other">
                  {Object.entries(reasonLabels).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Срок в часах (пусто — до пересмотра)">
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="8760"
                  name="durationHours"
                />
              </Field>
            </>
          )}
          {action === "restore" && (
            <Field label="Исходное решение">
              <select name="decisionId" required>
                <option value="">Выберите решение</option>
                {preview.value?.decisions
                  .filter((d: any) => d.active && !d.parent_id)
                  .map((d: any) => (
                    <option key={d.id} value={d.id}>
                      {d.reason} · {new Date(d.starts_at).toLocaleString()}
                    </option>
                  ))}
              </select>
              <small>
                Наследованная заморозка снимается отменой решения аккаунта
                владельца.
              </small>
            </Field>
          )}
          {action === "verification" && !target.verified && (
            <>
              <Field label="Тип статуса">
                <select
                  value={verifyType}
                  onChange={(e) => setVerifyType(e.target.value)}
                >
                  <option value="standard">Подтверждено</option>
                  <option value="orbit">Orbit · источник сети</option>
                </select>
              </Field>
              {verifyType === "standard" && (
                <Field label="Категория">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {categories.value?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {verifyType === "standard" &&
                !!categories.value?.find((c) => c.id === category)
                  ?.requires_country && (
                  <>
                    <Field label="Страна финансирования">
                      <select name="country" required>
                        <option value="">Выберите страну</option>
                        {Array.from({ length: 26 * 26 }, (_, i) =>
                          String.fromCharCode(
                            65 + Math.floor(i / 26),
                            65 + (i % 26),
                          ),
                        )
                          .filter((c) => {
                            try {
                              return (
                                new Intl.DisplayNames(["ru"], {
                                  type: "region",
                                }).of(c) !== c
                              );
                            } catch {
                              return false;
                            }
                          })
                          .map((c) => (
                            <option key={c} value={c}>
                              {new Intl.DisplayNames(["ru"], {
                                type: "region",
                              }).of(c)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Основание / источник сведений">
                      <textarea name="evidence" required maxLength={2000} />
                    </Field>
                  </>
                )}
            </>
          )}
          {action === "role" && (
            <>
              <Field label="Роль">
                <select name="role" defaultValue={target.role}>
                  {["USER", "ADMIN", "MODERATOR", "SUPPORT"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <label className="check">
                <input
                  name="manageAi"
                  type="checkbox"
                  defaultChecked={target.permissions?.manageAi}
                />
                Управление моделями (для ADMIN)
              </label>
              <label className="check">
                <input
                  name="createPersonas"
                  type="checkbox"
                  defaultChecked={target.permissions?.createPersonas}
                />
                Создание личностей (для ADMIN)
              </label>
            </>
          )}
          <Field label="Понятное объяснение">
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={2000}
              placeholder="Что произошло и почему применяется действие"
            />
          </Field>
          {preview.error && <p className="error">{preview.error}</p>}
          <Button className="primary" disabled={!preview.value}>
            Предпросмотр последствий
          </Button>
        </form>
      )}
    </Modal>
  );
}
export function AuditLog() {
  const [q, setQ] = useState(""),
    [actor, setActor] = useState(""),
    [target, setTarget] = useState(""),
    [action, setAction] = useState(""),
    [before, setBefore] = useState<number | undefined>(),
    [detail, setDetail] = useState<any>(null),
    data = useLoad<any>(
      () =>
        api(
          "/admin/audit-log?" +
            new URLSearchParams({
              q,
              actor,
              target,
              action,
              ...(before ? { before: String(before) } : {}),
            }),
        ),
      [q, actor, target, action, before],
    );
  return (
    <section className="panel">
      <h2>Журнал аудита</h2>
      <div className="form-grid">
        {[
          ["Текст", q, setQ],
          ["ID сотрудника", actor, setActor],
          ["ID объекта", target, setTarget],
          ["Действие", action, setAction],
        ].map(([label, value, set]: any) => (
          <Field label={label} key={label}>
            <input
              value={value}
              onChange={(e) => {
                set(e.target.value);
                setBefore(undefined);
              }}
            />
          </Field>
        ))}
      </div>
      {data.error && <p className="error">{data.error}</p>}
      {data.value?.items.map((x: any) => (
        <article className="audit-row" key={x.id}>
          <small>{new Date(x.createdAt).toLocaleString()}</small>
          <p>{x.summary}</p>
          <Button onClick={() => setDetail(x)}>Подробности</Button>
        </article>
      ))}
      <div className="button-row">
        {before && (
          <Button onClick={() => setBefore(undefined)}>
            К последним записям
          </Button>
        )}
        {data.value?.nextCursor && (
          <Button onClick={() => setBefore(data.value.nextCursor)}>
            Раньше
          </Button>
        )}
      </div>
      {detail && (
        <Modal title="Запись аудита" onClose={() => setDetail(null)}>
          <p>{detail.summary}</p>
          <p>Объект: {detail.target}</p>
          <p>Автор: {detail.actorName || "Orbit"}</p>
        </Modal>
      )}
    </section>
  );
}

function VerificationCategories() {
  const { toast } = useApp(),
    data = useLoad<any[]>(() => api("/verification/categories"));
  return (
    <details>
      <summary>Категории подтверждённых источников</summary>
      {data.value?.map((c) => (
        <p key={c.id}>
          {c.name} · {c.description}
        </p>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          try {
            await post("/admin/verification/categories", {
              name: f.get("name"),
              description: f.get("description"),
              style: f.get("style"),
              deriveBadge: f.get("deriveBadge") === "on",
              requiresCountry: f.get("requiresCountry") === "on",
            });
            form.reset();
            data.refresh();
            toast("Категория добавлена");
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      >
        <Field label="Новая категория">
          <input name="name" required minLength={2} maxLength={60} />
        </Field>
        <Field label="Описание для проверки">
          <textarea name="description" maxLength={500} />
        </Field>
        <Field label="Оформление">
          <select name="style">
            <option value="standard">Голубое</option>
            <option value="company">Тёмно-синее</option>
            <option value="diamond">Диамантовое</option>
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" name="deriveBadge" />
          Присваивать отметку владельцу канала
        </label>
        <label className="check">
          <input type="checkbox" name="requiresCountry" />
          Требовать страну финансирования и основание
        </label>
        <Button>Создать категорию</Button>
      </form>
    </details>
  );
}
export function ReportsDesk() {
  const { toast, user } = useApp(),
    data = useLoad<any[]>(() => api("/admin/reports")),
    [status, setStatus] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [target, setTarget] = useState<any>(null),
    [review, setReview] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const labels: any = {
    open: "Новая",
    reviewing: "На проверке",
    deferred: "Отложена",
    rejected: "Отклонена",
    resolved: "Рассмотрена",
  };
  return (
    <section className="panel">
      <h2>Жалобы · ручная модерация</h2>
      <Field label="Состояние">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все</option>
          {Object.entries(labels).map(([k, v]) => (
            <option value={k} key={k}>
              {v as string}
            </option>
          ))}
        </select>
      </Field>
      {data.error && <p className="error">{data.error}</p>}
      {data.value
        ?.filter((r) => !status || r.status === status)
        .map((r) => (
          <article className="audit-row" key={r.id}>
            <Tag>{labels[r.status]}</Tag>
            <p>{r.reason}</p>
            <small>
              {r.displayName} · {new Date(r.created_at).toLocaleString()}
            </small>
            <Button onClick={() => setSelected(r)}>Рассмотреть</Button>
          </article>
        ))}
      {selected && (
        <Modal title="Рассмотрение жалобы" onClose={() => setSelected(null)}>
          <p>{selected.reason}</p>
          <p>
            Жалоба не применяет санкцию автоматически. Действие относится к
            конкретному аккаунту или сообществу.
          </p>
          <Button
            onClick={async () => {
              try {
                const items = await api<any[]>(
                  "/admin/governance/" +
                    (selected.target_type === "space" ? "spaces" : "users"),
                );
                const x = items.find((x) => x.id === selected.target_id);
                if (!x) throw new Error("Объект уже удалён или недоступен");
                setTarget({ item: x, type: selected.target_type });
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            Действия над объектом жалобы
          </Button>
          {user.role === "OWNER" && (
            <Button
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setReview(
                    await post("/admin/reports/" + selected.id + "/review"),
                  );
                } catch (e) {
                  toast((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Рекомендация модели · платный запрос
            </Button>
          )}
          {review && (
            <p>
              {review.recommendation}: {review.rationale}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await patch("/admin/reports/" + selected.id, {
                  status: f.get("status"),
                  reason: f.get("reason"),
                });
                setSelected(null);
                setReview(null);
                data.refresh();
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            <Field label="Результат рассмотрения">
              <select name="status" defaultValue={selected.status}>
                {Object.entries(labels).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v as string}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Объяснение">
              <textarea name="reason" required minLength={3} maxLength={2000} />
            </Field>
            <Button>Сохранить решение по жалобе</Button>
          </form>
        </Modal>
      )}
      {target && (
        <ActionDialog
          target={target.item}
          type={target.type}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            data.refresh();
          }}
        />
      )}
    </section>
  );
}
