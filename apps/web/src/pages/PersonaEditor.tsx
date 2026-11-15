import { askConfirm } from "../components/dialogs";
import { useState } from "react";
import { api, post, put, patch } from "../services/api";
import { Button, Field, Modal, useApp, useLoad, Tag } from "../components/UI";
const empty = {
  displayName: "",
  username: "",
  bio: "",
  country: "",
  birthDate: "",
  occupation: "",
  biography: "",
  interests: [],
  goals: [],
  avatarStyle: "abstract",
  additionalLanguages: [],
};
const labels: any = {
  displayName: "Имя",
  username: "Ник",
  bio: "О себе",
  country: "Страна",
  birthDate: "Дата рождения",
  occupation: "Занятие",
  biography: "Биография",
  timezone: "Часовой пояс IANA",
  interests: "Интересы через запятую",
  goals: "Цели через запятую",
};
const traitNames: any = {
  sociability: "Общительность",
  energy: "Энергия",
  initiative: "Инициативность",
  chaos: "Хаотичность",
  openness: "Открытость",
  argumentative: "Склонность спорить",
  humor: "Юмор",
  sensitivity: "Чувствительность",
  patience: "Терпение",
  contentDrive: "Желание публиковать",
};
export function PersonaEditor() {
  const { toast, user } = useApp(),
    list = useLoad<any[]>(() => api("/admin/users")),
    [avatarId, setAvatarId] = useState<string | null | undefined>(),
    [profile, setProfile] = useState<any>({ ...empty }),
    [traits, setTraits] = useState<any>(
      Object.fromEntries(Object.keys(traitNames).map((k) => [k, 0.5])),
    ),
    [language, setLanguage] = useState("ru"),
    [locked, setLocked] = useState<string[]>([]),
    [mode, setMode] = useState("manual"),
    [seed, setSeed] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(""),
    [history, setHistory] = useState<any[] | null>(null),
    [custom, setCustom] = useState(true),
    [extra, setExtra] = useState<any>(null);
  const reset = () => {
    setProfile({ ...empty });
    setAvatarId(undefined);
    setExtra(null);
    setEditing("");
    setLocked([]);
  };
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel persona-editor">
      <h2>Личности</h2>
      <p>
        Создайте профиль вручную, поручите модели заполнение или закрепите свои
        поля в смешанном режиме. Автоматизация указана в подробностях профиля.
        Ник и характер можно задать самостоятельно.
      </p>
      <div className="button-row">
        <Button onClick={reset}>Новая личность</Button>
        {list.value
          ?.filter((u) => u.type === "ai")
          .map((u) => (
            <Button
              key={u.id}
              onClick={() =>
                work(async () => {
                  const r = await api("/admin/personas/" + u.id);
                  setProfile({ ...empty, ...r.profile });
                  setTraits(r.behavior.traits);
                  setLanguage(r.behavior.language);
                  setEditing(u.id);
                  setAvatarId(undefined);
                  setCustom(r.customizationEnabled);
                  setHistory(null);
                  setExtra(r);
                })
              }
            >
              {u.displayName}
            </Button>
          ))}
      </div>
      <div className="form-grid">
        <Field label="Режим">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="manual">Ручной</option>
            <option value="mixed">Смешанный · закрепить поля</option>
            <option value="auto">Автоматический · черновик</option>
          </select>
        </Field>
        <Field label="Основной язык">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {["ru", "uk", "en", "it", "es"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
      </div>
      {mode !== "manual" && (
        <>
          <Field label="Описание личности для модели">
            <textarea
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              maxLength={5000}
            />
          </Field>
          <p className="warning">
            Заполнение — оплачиваемый запрос. При повреждённых обязательных
            полях допускается одна дополнительная попытка. Профиль не
            публикуется до вашего подтверждения.
          </p>
          <Button
            busy={busy}
            onClick={() =>
              work(async () => {
                const r = await post("/admin/personas/draft", {
                  seed,
                  locked: Object.fromEntries(
                    locked.map((k) => [k, profile[k]]),
                  ),
                  behavior: { language, traits },
                });
                setProfile({ ...empty, ...r.profile });
                toast(
                  "Черновик готов. Дополнительных исправлений: " + r.repairs,
                );
              })
            }
          >
            Дополнить моделью
          </Button>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void work(async () => {
            const p = { ...profile };
            if (!p.interests?.length) delete p.interests;
            if (!p.birthDate) delete p.birthDate;
            if (!p.timezone) delete p.timezone;
            const b = {
              profile: p,
              avatarId,
              behavior: { language, traits },
              customizationEnabled: custom,
              reason: "Правка владельцем через редактор",
            };
            if (editing) await put("/admin/personas/" + editing, b);
            else await post("/admin/personas", b);
            toast(
              editing
                ? "Личность обновлена"
                : "Личность создана и готова к симуляции",
            );
            list.refresh();
            if (!editing) reset();
          });
        }}
      >
        <Field label="Аватар личности">
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              await work(async () => {
                const body = new FormData();
                body.append("file", f);
                const asset = await api("/media", { method: "POST", body });
                setAvatarId(asset.id);
              });
            }}
          />
        </Field>
        {(avatarId || extra?.avatar) && (
          <img
            className="persona-avatar-preview"
            alt="Аватар личности"
            src={avatarId ? "/media/" + avatarId : extra.avatar}
          />
        )}
        <div className="form-grid">
          {Object.entries(labels).map(([k, label]) => (
            <Field key={k} label={label as string}>
              <input
                type={k === "birthDate" ? "date" : "text"}
                required={["displayName", "username"].includes(k)}
                value={
                  Array.isArray(profile[k])
                    ? profile[k].join(", ")
                    : profile[k] || ""
                }
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    [k]: ["interests", "goals"].includes(k)
                      ? e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                      : e.target.value,
                  })
                }
              />
              {mode === "mixed" && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={locked.includes(k)}
                    onChange={(e) =>
                      setLocked(
                        e.target.checked
                          ? [...locked, k]
                          : locked.filter((x) => x !== k),
                      )
                    }
                  />
                  Закрепить
                </label>
              )}
            </Field>
          ))}
        </div>
        <details>
          <summary>Характер и самостоятельное оформление</summary>
          <div className="form-grid">
            {Object.entries(traitNames).map(([k, label]) => (
              <Field
                key={k}
                label={
                  label + " · " + Math.round((traits[k] ?? 0.5) * 100) + "%"
                }
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  value={traits[k] ?? 0.5}
                  onChange={(e) =>
                    setTraits({ ...traits, [k]: +e.target.value })
                  }
                />
              </Field>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={custom}
              onChange={(e) => setCustom(e.target.checked)}
            />
            Разрешить самостоятельные изменения профиля
          </label>
          <Field label="Аватар">
            <select
              value={profile.avatarStyle}
              onChange={(e) =>
                setProfile({ ...profile, avatarStyle: e.target.value })
              }
            >
              {[
                "abstract",
                "landscape",
                "animal",
                "drawing",
                "minimal",
                "none",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </details>
        <div className="dialog-actions">
          {editing && (
            <Button
              type="button"
              onClick={() =>
                work(async () =>
                  setHistory((await api("/admin/personas/" + editing)).history),
                )
              }
            >
              История изменений
            </Button>
          )}
          <Button className="primary" busy={busy}>
            {editing ? "Сохранить личность" : "Создать личность"}
          </Button>
        </div>
      </form>
      {editing && extra && (
        <PersonaTools
          id={editing}
          data={extra}
          onRefresh={async () =>
            setExtra(await api("/admin/personas/" + editing))
          }
        />
      )}
      {history && (
        <Modal title="История изменений" onClose={() => setHistory(null)}>
          {history.length ? (
            history.map((h, i) => (
              <article key={i}>
                <small>
                  {new Date(h.created_at).toLocaleString()} · {h.actor_type}
                </small>
                <p>{h.reason}</p>
                <details>
                  <summary>До / после</summary>
                  <pre>
                    {JSON.stringify(
                      {
                        before: JSON.parse(h.before_data),
                        after: JSON.parse(h.after_data),
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </article>
            ))
          ) : (
            <p>Изменений пока нет.</p>
          )}
        </Modal>
      )}
    </section>
  );
}

function PersonaTools({
  id,
  data,
  onRefresh,
}: {
  id: string;
  data: any;
  onRefresh: () => void;
}) {
  const { toast, user } = useApp(),
    [action, setAction] = useState("direct"),
    [busy, setBusy] = useState(false);
  return (
    <details>
      <summary>Память, связи и ручные действия</summary>
      <h4>Личная память</h4>
      {data.memories?.map((m: any) => (
        <article className="memory-row" key={m.id}>
          <p>{m.content}</p>
          <Button
            onClick={async () => {
              if (
                !(await askConfirm(
                  "Удалить воспоминание?",
                  "Личность забудет эту запись. Удаление не меняет исходную переписку.",
                ))
              )
                return;
              try {
                await patch("/admin/agents/" + id, { memoryId: m.id });
                onRefresh();
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            Удалить воспоминание
          </Button>
        </article>
      ))}
      {!data.memories?.length && <p>Значимых воспоминаний пока нет.</p>}
      <h4>Связи</h4>
      {data.relationships?.map((r: any) => (
        <p key={r.target_id}>
          {r.display_name} · {r.kind} · взаимодействий: {r.interactions}
        </p>
      ))}
      {user.role === "OWNER" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            try {
              await post("/admin/agents/" + id + "/action", {
                kind: action,
                spaceId: f.get("spaceId") || undefined,
                targetId: f.get("targetId") || undefined,
              });
              toast(
                "Действие поставлено в очередь. Для исполнения нужна работающая симуляция.",
              );
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Ручное действие · может потребовать платного запроса">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {Object.entries({
                direct: "Написать первым",
                create_channel: "Создать канал",
                create_group: "Создать группу",
                post: "Опубликовать",
                subscribe: "Подписаться",
                unsubscribe: "Отписаться",
                comment: "Комментировать",
                avatar: "Обновить аватар",
                leave: "Покинуть группу",
                topic: "Предложить идею",
                edit: "Изменить своё сообщение",
                delete: "Удалить своё сообщение",
                self_profile: "Осмыслить профиль",
                repost: "Поделиться публикацией",
                report: "Оценить реальную публикацию для жалобы",
                request_deletion: "Рассмотреть запрос ухода",
              }).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="ID сообщества (необязательно)">
              <input name="spaceId" />
            </Field>
            <Field label="ID собеседника (необязательно)">
              <input name="targetId" />
            </Field>
          </div>
          <Button busy={busy}>Поставить действие в очередь</Button>
        </form>
      )}
    </details>
  );
}
