import { useState } from "react";
import {
  AtSign,
  Copy,
  Globe,
  Info,
  MessageCircle,
  UserRound,
  Users,
  Image,
  FileText,
  Shield,
  Heart,
  Bell,
  Pin,
  ArrowUpRight,
  Settings,
  Check,
  Megaphone,
  Camera,
  Link,
  Trash2,
  X,
} from "lucide-react";
import { api, post, put, patch } from "../services/api";
import {
  useApp,
  Modal,
  Avatar,
  Button,
  Field,
  Tag,
  useLoad,
  Loading,
  date,
} from "../components/UI";
import { StatusIcons } from "../components/Crystal";
import { Verified } from "../components/Crystal";
import { askText, askConfirm } from "../components/dialogs";
import { languageNames } from "../i18n";
import type { User, Space } from "../../../../packages/shared/types";
export function MediaViewer({
  items,
  index = 0,
  onClose,
}: {
  items: any[];
  index?: number;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(index),
    item = items[current];
  return (
    <Modal title={item.name || "Просмотр вложения"} wide onClose={onClose}>
      <div className="media-viewer">
        {item.mime?.startsWith("image/") ? (
          <img src={`/media/${item.id}`} alt={item.name || "Изображение"} />
        ) : item.mime?.startsWith("video/") ? (
          <video controls preload="metadata" src={"/media/" + item.id} />
        ) : item.mime?.startsWith("audio/") ? (
          <audio controls preload="metadata" src={"/media/" + item.id} />
        ) : (
          <a className="btn primary" href={`/media/${item.id}`} download>
            <FileText size={20} />
            Скачать файл
          </a>
        )}
      </div>
      <div className="button-row">
        <Button disabled={!current} onClick={() => setCurrent(current - 1)}>
          ← Назад
        </Button>
        <span>
          {current + 1} / {items.length}
        </span>
        <Button
          disabled={current === items.length - 1}
          onClick={() => setCurrent(current + 1)}
        >
          Далее →
        </Button>
      </div>
    </Modal>
  );
}
function Materials({ items }: { items: any[] }) {
  const [view, setView] = useState<number | null>(null);
  return (
    <>
      <div className="profile-media">
        {items.slice(0, 8).map((m, i) => (
          <button key={m.id + i} onClick={() => setView(i)} title={m.name}>
            {m.mime?.startsWith("image/") ? (
              <img src={"/media/" + m.id} alt={m.name} loading="lazy" />
            ) : (
              <>
                <FileText />
                <small>{m.name}</small>
              </>
            )}
          </button>
        ))}
      </div>
      {view !== null && (
        <MediaViewer items={items} index={view} onClose={() => setView(null)} />
      )}
    </>
  );
}
async function copy(text: string, toast: (s: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Скопировано");
  } catch {
    await askText("Скопируйте ссылку", text);
  }
}
export function UserProfile({
  profile,
  onClose,
  onMessage,
  onOpenSpace,
}: {
  profile: User;
  onClose: () => void;
  onMessage: (u: User) => void;
  onOpenSpace?: (id: string) => void;
}) {
  const { user, t, toast, setUser } = useApp(),
    self = profile.id === user.id;
  const data = useLoad<any>(() => api("/users/" + profile.id), [profile.id]),
    related = useLoad<any>(
      () => api(`/users/${profile.id}/materials`),
      [profile.id],
    );
  const [editing, setEditing] = useState(false),
    [tab, setTab] = useState("overview"),
    [dirty, setDirty] = useState(false),
    [avatar, setAvatar] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const u = data.value || profile;
  const close = async () => {
    if (
      dirty &&
      !(await askConfirm(
        "Не сохранять изменения?",
        "Изменения в профиле будут потеряны.",
      ))
    )
      return;
    onClose();
  };
  const common = related.value?.common || [],
    media = related.value?.materials || [];
  async function leaveEditor() {
    if (
      editing &&
      dirty &&
      !(await askConfirm(
        "Не сохранять изменения?",
        "Изменения в профиле будут потеряны.",
      ))
    )
      return false;
    setEditing(false);
    setDirty(false);
    setAvatar(null);
    return true;
  }
  return (
    <Modal
      title={self ? "Мой профиль" : "Профиль пользователя"}
      wide
      onClose={close}
    >
      <div className="profile-layout">
        <aside className="profile-card">
          <div className="profile-avatar-orbit">
            <Avatar
              name={u.displayName}
              src={avatar ? "/media/" + avatar : u.avatar}
              size={144}
              ai={u.type === "ai"}
            />
          </div>
          <h2>
            {u.displayName}
            <StatusIcons item={u} targetType="user" />
          </h2>
          <p className="profile-status">
            <span>
              {u.presence?.online
                ? "В сети"
                : u.presence?.lastSeen
                  ? "Был(а) " + new Date(u.presence.lastSeen).toLocaleString()
                  : "Статус скрыт"}
            </span>
          </p>
          <button
            className="username-link"
            onClick={() => copy("@" + u.username, toast)}
          >
            @{u.username}
            <Copy size={14} />
          </button>
          {u.bio && <p className="profile-bio">{u.bio}</p>}
          {u.age !== null && u.age !== undefined && (
            <p className="muted">{u.age} лет</p>
          )}
          {self ? (
            <Button
              className="primary full"
              onClick={async () => {
                if (editing) await leaveEditor();
                else setEditing(true);
              }}
            >
              <Settings size={18} />
              {editing ? "Смотреть профиль" : "Редактировать профиль"}
            </Button>
          ) : (
            <>
              <Button className="primary full" onClick={() => onMessage(u)}>
                <MessageCircle size={18} />
                Написать
              </Button>
              <div className="button-row">
                <Button
                  className="full"
                  onClick={async () => {
                    try {
                      await post(`/users/${u.id}/follow`);
                      data.refresh();
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  <Heart size={16} />
                  {u.following ? "Отписаться" : "Подписаться"}
                </Button>
              </div>
            </>
          )}
          <nav className="profile-nav">
            {[
              ["overview", "Обзор", UserRound],
              ["common", "Общие группы", Users],
              ["media", "Медиа и файлы", Image],
            ].map(([id, label, Icon]: any) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={async () => {
                  if (await leaveEditor()) setTab(id);
                }}
              >
                <Icon size={18} />
                {label}
                <span>
                  {id === "common"
                    ? common.length
                    : id === "media"
                      ? media.length
                      : ""}
                </span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="profile-content">
          {data.error ? (
            <p className="error">{data.error}</p>
          ) : editing ? (
            <form
              onChange={() => setDirty(true)}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const f = Object.fromEntries(new FormData(e.currentTarget));
                  const result = await patch("/users/me", {
                    ...f,
                    birthDate: f.birthDate || null,
                    avatar,
                  });
                  setUser(result);
                  setDirty(false);
                  setEditing(false);
                  data.refresh();
                  toast("Профиль сохранён");
                } catch (e) {
                  toast((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2>Редактировать профиль</h2>
              <Field label="Аватар">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const body = new FormData();
                    body.append("file", file);
                    try {
                      const a = await api("/media", { method: "POST", body });
                      setAvatar(a.id);
                      setDirty(true);
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                />
              </Field>
              <Field label="Отображаемое имя">
                <input
                  name="displayName"
                  required
                  maxLength={60}
                  defaultValue={u.displayName}
                />
              </Field>
              <Field label="Имя пользователя">
                <input
                  name="username"
                  required
                  pattern="[a-zA-Z0-9_.]{3,32}"
                  defaultValue={u.username}
                />
                <small>
                  3–32 латинских символа, цифры, точка или подчёркивание.
                </small>
              </Field>
              <Field label="О себе">
                <textarea name="bio" maxLength={1000} defaultValue={u.bio} />
              </Field>
              <div className="form-grid">
                <Field label="Язык">
                  <select name="language" defaultValue={u.language}>
                    {Object.entries(languageNames).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Страна (необязательно)">
                  <input
                    name="country"
                    maxLength={80}
                    defaultValue={u.country}
                  />
                </Field>
              </div>
              <Field label="Дата рождения (необязательно)">
                <input
                  type="date"
                  name="birthDate"
                  defaultValue={u.birthDate || ""}
                />
              </Field>
              <Field label="Кто видит присутствие">
                <select
                  name="presenceVisibility"
                  defaultValue={u.presenceVisibility || "everyone"}
                >
                  <option value="everyone">Все</option>
                  <option value="contacts">Взаимные контакты</option>
                  <option value="nobody">Никто</option>
                </select>
              </Field>
              <Field label="Кто может написать первым">
                <select name="privacy" defaultValue={u.privacy || "everyone"}>
                  <option value="everyone">Все участники</option>
                  <option value="contacts">
                    Только те, на кого я подписан
                  </option>
                </select>
              </Field>
              <div className="dialog-actions">
                <Button
                  type="button"
                  onClick={async () => {
                    if (
                      !dirty ||
                      (await askConfirm(
                        "Отменить изменения?",
                        "Несохранённые данные будут потеряны.",
                      ))
                    ) {
                      setEditing(false);
                      setDirty(false);
                    }
                  }}
                >
                  Отмена
                </Button>
                <Button className="primary" busy={busy}>
                  Сохранить
                </Button>
              </div>
            </form>
          ) : (
            <>
              {tab === "overview" && (
                <>
                  <section className="panel">
                    <h3>
                      <Info size={18} />
                      Основная информация
                    </h3>
                    <dl className="info-rows">
                      <div>
                        <dt>
                          <UserRound size={17} />
                          Имя
                        </dt>
                        <dd>
                          {u.displayName}
                          <Verified value={u.verified} />
                        </dd>
                      </div>
                      <div>
                        <dt>
                          <AtSign size={17} />
                          Никнейм
                        </dt>
                        <dd>@{u.username}</dd>
                      </div>
                      <div>
                        <dt>
                          <Globe size={17} />
                          Язык
                        </dt>
                        <dd>
                          {
                            languageNames[
                              u.language as keyof typeof languageNames
                            ]
                          }
                        </dd>
                      </div>
                      {u.bio && (
                        <div>
                          <dt>
                            <Info size={17} />О себе
                          </dt>
                          <dd className="multiline">{u.bio}</dd>
                        </div>
                      )}
                      <div>
                        <dt>
                          <Shield size={17} />
                          Тип аккаунта
                        </dt>
                        <dd>
                          {u.type === "ai" ? "Управляется ИИ" : "Человек"}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  {common.length > 0 && (
                    <section className="panel">
                      <h3>
                        <Users size={18} />
                        Общие группы · {common.length}
                      </h3>
                      {common.slice(0, 4).map((g: any) => (
                        <button
                          className="list-button"
                          key={g.id}
                          onClick={() => {
                            onOpenSpace?.(g.id);
                            onClose();
                          }}
                        >
                          <Avatar name={g.title} size={36} />
                          {g.title}
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                    </section>
                  )}
                  {media.length > 0 && (
                    <section className="panel">
                      <h3>
                        <Image size={18} />
                        Доступные материалы
                      </h3>
                      <Materials items={media} />
                    </section>
                  )}
                  <section className="panel">
                    <h3>Действия</h3>
                    <div className="stack">
                      <Button
                        onClick={() =>
                          copy(location.origin + "/?user=" + u.id, toast)
                        }
                      >
                        <Link size={17} />
                        Поделиться профилем
                      </Button>
                      {!self && (
                        <>
                          <Button
                            className="danger"
                            onClick={async () => {
                              if (
                                !(await askConfirm(
                                  u.blocked
                                    ? "Разблокировать пользователя?"
                                    : "Заблокировать пользователя?",
                                  u.blocked
                                    ? "Личная переписка снова станет доступна."
                                    : "Пользователь не сможет писать вам в личной переписке.",
                                ))
                              )
                                return;
                              try {
                                await post(`/users/${u.id}/block`);
                                data.refresh();
                              } catch (e) {
                                toast((e as Error).message);
                              }
                            }}
                          >
                            <Shield size={17} />
                            {u.blocked ? "Разблокировать" : "Заблокировать"}
                          </Button>
                          <Button
                            onClick={async () => {
                              const reason = await askText(
                                "Причина жалобы",
                                "",
                                "Опишите конкретную ситуацию.",
                                true,
                              );
                              if (reason)
                                try {
                                  await post("/reports", {
                                    targetId: u.id,
                                    reason,
                                  });
                                  toast("Жалоба отправлена");
                                } catch (e) {
                                  toast((e as Error).message);
                                }
                            }}
                          >
                            Пожаловаться
                          </Button>
                        </>
                      )}
                    </div>
                  </section>
                </>
              )}
              {tab === "common" && (
                <section className="panel">
                  <h2>Общие группы</h2>
                  {common.length ? (
                    common.map((g: any) => (
                      <button
                        key={g.id}
                        className="list-button"
                        onClick={() => {
                          onOpenSpace?.(g.id);
                          onClose();
                        }}
                      >
                        <Users size={18} />
                        {g.title}
                      </button>
                    ))
                  ) : (
                    <p className="muted">У вас пока нет общих групп.</p>
                  )}
                </section>
              )}
              {tab === "media" && (
                <section className="panel">
                  <h2>Медиа и файлы</h2>
                  {media.length ? (
                    <Materials items={media} />
                  ) : (
                    <p className="muted">
                      В вашей личной переписке пока нет вложений.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
export function CommunityProfile({
  space,
  onClose,
  onProfile,
  onRefresh,
  onManage,
}: {
  space: Space;
  onClose: () => void;
  onProfile: (u: User) => void;
  onRefresh: () => void;
  onManage: () => void;
}) {
  const { toast } = useApp();
  const {
    value: s,
    error,
    refresh,
  } = useLoad<any>(() => api(`/spaces/${space.id}/profile`), [space.id]);
  async function action(fn: () => Promise<any>) {
    try {
      await fn();
      refresh();
      onRefresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <Modal
      title={
        space.kind === "channel" ? "Информация о канале" : "Информация о группе"
      }
      wide
      onClose={onClose}
    >
      {error ? (
        <p className="error">{error}</p>
      ) : !s ? (
        <Loading />
      ) : (
        <div className="profile-layout community-profile">
          <aside className="profile-card">
            <div className="profile-avatar-orbit">
              <Avatar name={s.title} src={s.avatar} size={154} />
            </div>
            <h2>
              {s.title}
              <StatusIcons item={s} />
            </h2>
            <Tag>
              {s.kind === "channel" ? "Канал" : "Группа"} ·{" "}
              {s.visibility === "public" ? "Публичный" : "Приватный"}
            </Tag>
            <p className="profile-bio">
              {s.description || "Описание пока не добавлено"}
            </p>
            <Button
              className="primary full"
              onClick={() =>
                s.joined
                  ? onClose()
                  : action(() => post(`/spaces/${s.id}/join`))
              }
            >
              {s.joined
                ? s.kind === "channel"
                  ? "Открыть канал"
                  : "Открыть чат"
                : s.kind === "channel"
                  ? "Подписаться"
                  : "Вступить"}
            </Button>
            {s.joined && (
              <Button
                className="full"
                onClick={() =>
                  action(() =>
                    patch(`/spaces/${s.id}/preferences`, { muted: !s.muted }),
                  )
                }
              >
                <Bell size={17} />
                {s.muted ? "Включить уведомления" : "Выключить уведомления"}
              </Button>
            )}
            {s.visibility === "public" && (
              <Button
                className="full"
                onClick={() => copy(`${location.origin}/?space=${s.id}`, toast)}
              >
                <Copy size={17} />
                Поделиться
              </Button>
            )}
          </aside>
          <div className="profile-content">
            <section className="panel">
              <h3>
                <Info size={18} />
                Информация
              </h3>
              <dl className="info-rows">
                <div>
                  <dt>Название</dt>
                  <dd>
                    {s.title}
                    <Verified value={s.verified} />
                  </dd>
                </div>
                <div>
                  <dt>Тип</dt>
                  <dd>{s.kind === "channel" ? "Канал" : "Группа"}</dd>
                </div>
                {s.visibility === "public" && (
                  <div>
                    <dt>Адрес</dt>
                    <dd>@{s.slug}</dd>
                  </div>
                )}
                <div>
                  <dt>{s.kind === "channel" ? "Подписчики" : "Участники"}</dt>
                  <dd>{s.members}</dd>
                </div>
                {s.description && (
                  <div>
                    <dt>О сообществе</dt>
                    <dd className="multiline">{s.description}</dd>
                  </div>
                )}
              </dl>
            </section>
            {s.pinnedMessage && (
              <section className="panel">
                <h3>
                  <Pin size={18} />
                  Закреплённая публикация
                </h3>
                <p>{s.pinnedMessage.text.slice(0, 240)}</p>
              </section>
            )}
            {s.materials.length > 0 && (
              <section className="panel">
                <h3>
                  <Image size={18} />
                  Медиа и файлы · {s.materials.length}
                </h3>
                <Materials items={s.materials} />
              </section>
            )}
            {s.kind === "group" && s.participants && (
              <section className="panel">
                <h3>
                  <Users size={18} />
                  Участники группы
                </h3>
                {s.participants.map((u: any) => (
                  <button
                    key={u.id}
                    className="member-row"
                    onClick={() => {
                      onClose();
                      onProfile(u);
                    }}
                  >
                    <Avatar name={u.displayName} src={u.avatar} size={38} />
                    <span>
                      {u.displayName}
                      <Verified value={u.verified} />
                      <small>
                        {u.memberRole === "admin"
                          ? "Администратор"
                          : "Участник"}
                      </small>
                    </span>
                  </button>
                ))}
              </section>
            )}
            {s.joined && (
              <Button
                onClick={() =>
                  action(() =>
                    patch(`/spaces/${s.id}/preferences`, { pinned: !s.pinned }),
                  )
                }
              >
                <Pin size={17} />
                {s.pinned ? "Открепить диалог" : "Закрепить диалог"}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
export function CommunitySettings({
  space,
  onClose,
  onRefresh,
}: {
  space: Space;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useApp();
  const {
    value: s,
    error,
    refresh,
  } = useLoad<any>(() => api(`/spaces/${space.id}/manage`), [space.id]);
  const choices = useLoad<any[]>(() => api("/spaces"));
  const [section, setSection] = useState("general"),
    [rights, setRights] = useState<any>(null);
  const [dirty, setDirty] = useState(false),
    [avatarId, setAvatarId] = useState<string | null | undefined>(undefined),
    [busy, setBusy] = useState(false);
  const close = async () => {
    if (
      dirty &&
      !(await askConfirm(
        "Закрыть настройки?",
        "Несохранённые изменения будут потеряны.",
      ))
    )
      return;
    onClose();
  };
  return (
    <Modal
      title={space.kind === "channel" ? "Настройки канала" : "Настройки группы"}
      wide
      onClose={close}
    >
      {rights && (
        <AdminRights
          admin={rights}
          spaceId={space.id}
          onClose={() => setRights(null)}
          onDone={() => {
            setRights(null);
            refresh();
          }}
        />
      )}
      {error ? (
        <p className="error">{error}</p>
      ) : !s ? (
        <Loading />
      ) : (
        <div className="community-editor">
          <div className="section-tabs">
            {Object.entries({
              general: "Настройки",
              reactions: "Реакции",
              members: "Участники",
              admins: "Администраторы",
              author: "Автор поста",
              comments: "Комментарии",
              ownership: "Владение",
            }).map(([k, v]) => (
              <Button
                key={k}
                className={section === k ? "active" : ""}
                onClick={() => setSection(k)}
              >
                {v}
              </Button>
            ))}
          </div>
          {section === "members" && (
            <section className="panel">
              <h3>Участники · {s.members.length}</h3>
              <p>
                Список доступен в управлении; публичный профиль канала не
                раскрывает администраторов.
              </p>
              {s.members.map((u: any) => (
                <div className="member-row" key={u.id}>
                  <Avatar name={u.displayName} src={u.avatar} size={38} />
                  <span>
                    {u.displayName}
                    <small>
                      @{u.username} · {u.memberRole}
                    </small>
                  </span>
                </div>
              ))}
            </section>
          )}
          {section === "ownership" && (
            <OwnershipSettings
              space={s}
              refresh={() => {
                refresh();
                onRefresh();
              }}
            />
          )}

          <form
            className={"community-section " + section}
            style={{
              display: ["members", "admins", "ownership"].includes(section)
                ? "none"
                : undefined,
            }}
            onChange={() => setDirty(true)}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await put(`/spaces/${s.id}/manage`, {
                  title: f.get("title"),
                  slug: f.get("slug"),
                  description: f.get("description"),
                  rules: f.get("rules"),
                  visibility: f.get("visibility"),
                  avatarId,
                  allowedReactions: f.getAll("reaction"),
                  membersVisibility: s.isOwner
                    ? f.get("membersVisibility")||s.members_visibility
                    : undefined,
                  adminsVisibility: s.isOwner
                    ? f.get("adminsVisibility")||s.admins_visibility
                    : undefined,
                  reactionsEnabled: f.get("reactionsEnabled") === "on",
                  showAuthor: s.isOwner
                    ? f.get("showAuthor") === "on"
                    : undefined,
                  commentsMode: f.get("commentsMode"),
                  discussionId: f.get("discussionId") || null,
                });
                setDirty(false);
                onRefresh();
                refresh();
                toast("Настройки сообщества сохранены");
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="settings-general">
              <div className="avatar-edit">
                <Avatar
                  name={s.title}
                  src={avatarId ? "/media/" + avatarId : s.avatar}
                  size={88}
                />
                <Field label="Аватар сообщества">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const body = new FormData();
                      body.append("file", file);
                      try {
                        const asset = await api("/media", {
                          method: "POST",
                          body,
                        });
                        setAvatarId(asset.id);
                        setDirty(true);
                      } catch (e) {
                        toast((e as Error).message);
                      }
                    }}
                  />
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Название">
                  <input
                    required
                    name="title"
                    maxLength={100}
                    defaultValue={s.title}
                  />
                </Field>
                <Field label="Адрес">
                  <input
                    required
                    name="slug"
                    pattern="[a-zA-Z0-9_-]{3,64}"
                    defaultValue={s.slug}
                  />
                </Field>
              </div>
              <Field label="О себе / описание">
                <textarea
                  name="description"
                  maxLength={2000}
                  defaultValue={s.description}
                />
              </Field>
              <Field label="Доступ">
                <select name="visibility" defaultValue={s.visibility}>
                  <option value="public">Публичное сообщество</option>
                  <option value="private">Приватное сообщество</option>
                </select>
              </Field>
              <Field label="Правила">
                <textarea
                  name="rules"
                  maxLength={2000}
                  defaultValue={s.rules}
                />
              </Field>
              {s.isOwner&&<><Field label="Кто видит подписчиков"><select name="membersVisibility" defaultValue={s.members_visibility}><option value="admins">Уполномоченные администраторы</option><option value="members">Участники сообщества</option></select></Field><Field label="Кто видит администраторов в управлении"><select name="adminsVisibility" defaultValue={s.admins_visibility}><option value="admins">Администраторы</option><option value="owner">Только владелец</option></select></Field></>}
            </div>
            <div className="settings-reactions">
              <h3>Реакции</h3>
              <label className="check">
                <input
                  type="checkbox"
                  name="reactionsEnabled"
                  defaultChecked={!!s.reactions_enabled}
                />
                Разрешить реакции в сообществе
              </label>
              <p className="muted">
                Снимите все отметки, чтобы отключить реакции.
              </p>
              <div className="reaction-settings">
                {["❤", "👍", "🔥", "😂", "🤔", "👀"].map((emoji) => (
                  <label key={emoji}>
                    <input
                      type="checkbox"
                      name="reaction"
                      value={emoji}
                      defaultChecked={s.allowedReactions.includes(emoji)}
                    />
                    {emoji}
                  </label>
                ))}
              </div>
            </div>
            <div className="settings-author">
              <h3>Подпись автора</h3>
              <label className="check">
                <input
                  type="checkbox"
                  name="showAuthor"
                  defaultChecked={!!s.show_author}
                  disabled={!s.isOwner}
                />
                Показывать имя автора под публикацией
              </label>
              <p>Аватар и основное имя публикации всегда принадлежат каналу.</p>
            </div>
            <div className="settings-comments">
              <h3>Обсуждение публикаций</h3>
              <Field label="Режим">
                <select name="commentsMode" defaultValue={s.comments_mode}>
                  <option value="none">Выключено</option>
                  <option value="internal">Внутри канала</option>
                  <option value="group">В привязанной группе</option>
                </select>
              </Field>
              <Field label="Группа обсуждения">
                <select
                  name="discussionId"
                  defaultValue={s.discussion_id || ""}
                >
                  <option value="">Выберите группу, которой управляете</option>
                  {choices.value
                    ?.filter((g) => g.kind === "group" && g.canManage)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                </select>
              </Field>
              <p>
                Для привязанной группы нужны права управления. Комментаторы
                должны иметь доступ в группу. Старые обсуждения сохраняются при
                смене режима.
              </p>
            </div>
            {space.kind === "channel" && (
              <p className="notice">
                <Megaphone size={18} />
                Публикации выходят от имени канала.
              </p>
            )}
            <div className="dialog-actions">
              <Button type="button" onClick={close}>
                Отмена
              </Button>
              <Button className="primary" busy={busy}>
                Сохранить изменения
              </Button>
            </div>
          </form>
          <section
            className="panel admin-management"
            style={{ display: section === "admins" ? undefined : "none" }}
          >
            <h3>
              <Shield size={18} />
              Администраторы
            </h3>
            <p className="muted">
              Этот раздел виден только в управлении. В публичном профиле канала
              имён администраторов нет.
            </p>
            {s.admins.map((u: any) => (
              <div className="member-row" key={u.id}>
                <Avatar name={u.displayName} src={u.avatar} size={38} />
                <span>
                  {u.displayName}
                  <small>
                    @{u.username} ·{" "}
                    {u.canPublish
                      ? "Может публиковать"
                      : "Без права публикации"}
                  </small>
                </span>
                {(s.isOwner ||
                  JSON.parse(s.member?.permissions || "{}").admins) &&
                  u.id !== s.owner_id && (
                    <Button onClick={() => setRights(u)}>Права</Button>
                  )}
                {s.isOwner && u.id !== s.owner_id && (
                  <button
                    className="icon danger"
                    title="Снять администратора"
                    onClick={async () => {
                      if (
                        !(await askConfirm(
                          "Снять администратора?",
                          `@${u.username} потеряет права управления.`,
                        ))
                      )
                        return;
                      try {
                        await post(`/spaces/${s.id}/admins`, {
                          username: u.username,
                          action: "remove",
                        });
                        refresh();
                        onRefresh();
                      } catch (e) {
                        toast((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            ))}
            {(s.isOwner ||
              JSON.parse(s.member?.permissions || "{}").admins) && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  setBusy(true);
                  try {
                    await post(`/spaces/${s.id}/admins`, {
                      username: f.get("username"),
                      action: "add",
                      canPublish: f.get("canPublish") === "on",
                      permissions: Object.fromEntries(
                        [
                          "publish",
                          "edit",
                          "delete",
                          "settings",
                          "members",
                          "admins",
                        ].map((k) => [k, f.get(k) === "on"]),
                      ),
                    });
                    refresh();
                    onRefresh();
                    form.reset();
                    toast("Права администратора сохранены");
                  } catch (e) {
                    toast((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field label="Имя пользователя администратора">
                  <input
                    name="username"
                    placeholder="username без @"
                    required
                    pattern="@?[a-zA-Z0-9_.]{3,32}"
                  />
                </Field>
                <label className="check">
                  <input name="canPublish" type="checkbox" defaultChecked />
                  Разрешить публиковать посты
                </label>
                <div className="form-grid">
                  {Object.entries({
                    publish: "Публикация",
                    edit: "Редактирование",
                    delete: "Удаление постов",
                    settings: "Оформление и настройки",
                    members: "Участники",
                    admins: "Назначение администраторов",
                  }).map(([k, v]) => (
                    <label className="check" key={k}>
                      <input
                        type="checkbox"
                        name={k}
                        defaultChecked={k !== "admins"}
                      />
                      {v}
                    </label>
                  ))}
                </div>
                <Button busy={busy}>
                  <Shield size={17} />
                  Назначить администратора
                </Button>
              </form>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function OwnershipSettings({
  space: s,
  refresh,
}: {
  space: any;
  refresh: () => void;
}) {
  const { toast } = useApp(),
    [username, setUsername] = useState(""),
    [wizard, setWizard] = useState(false),
    [decisions, setDecisions] = useState<any[]>([]);
  async function perform(fn: () => Promise<any>) {
    try {
      await fn();
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <h3>Владение и статус</h3>
      <p>
        ID сообщества: <code>{s.id}</code>
      </p>
      {s.isOwner && (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await askConfirm(
                  "Предложить передачу владения?",
                  "До принятия вы останетесь владельцем. После принятия ваши права управления будут сняты, а верификация приостановлена.",
                )
              )
                void perform(() =>
                  post("/spaces/" + s.id + "/transfer", { username }),
                );
            }}
          >
            <Field label="Ник будущего владельца">
              <input
                value={username}
                required
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username"
              />
            </Field>
            <Button>Предложить передачу</Button>
          </form>
          {s.transfers?.map((t: any) => (
            <p key={t.id}>
              Ожидает принятия: {t.recipient}
              <Button
                onClick={() =>
                  perform(() =>
                    post("/notify/transfers/" + t.id, { action: "cancel" }),
                  )
                }
              >
                Отменить
              </Button>
            </p>
          ))}
          {s.delete_at ? (
            <>
              <p>Удаление: {new Date(s.delete_at).toLocaleString()}</p>
              <Button
                onClick={() =>
                  perform(() => post("/spaces/" + s.id + "/cancel-delete"))
                }
              >
                Отменить удаление
              </Button>
            </>
          ) : (
            <Button
              className="danger"
              onClick={async () => {
                if (
                  await askConfirm(
                    "Удалить сообщество?",
                    "Начнётся серверный отсчёт 30 секунд. Затем сообщество и его контент будут удалены безвозвратно. До окончания можно отменить в Notify.",
                  )
                )
                  void perform(() => post("/spaces/" + s.id + "/delete"));
              }}
            >
              Удалить сообщество
            </Button>
          )}
        </>
      )}
      <Button onClick={() => setWizard(true)}>
        Запросить проверку статуса
      </Button>
      {wizard && (
        <VerificationRequest spaceId={s.id} onClose={() => setWizard(false)} />
      )}
      <VerificationHistory spaceId={s.id} />
    </section>
  );
}
function VerificationRequest({
  spaceId,
  onClose,
}: {
  spaceId: string;
  onClose: () => void;
}) {
  const { toast } = useApp();
  return (
    <Modal title="Запрос подтверждения сообщества" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await post("/notify/tickets", {
              kind: "verification",
              subject: "Проверка статуса сообщества",
              body: f.get("body"),
              targetType: "space",
              targetId: spaceId,
              requestKey: crypto.randomUUID(),
              mediaIds: [],
            });
            toast("Заявка отправлена в Notify");
            onClose();
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      >
        <Field label="Опишите источник, категорию и основание проверки">
          <textarea required name="body" minLength={10} maxLength={10000} />
        </Field>
        <p>
          Решение принимает владелец Orbit. Доказательства можно дополнить в
          обращении Notify.
        </p>
        <Button>Отправить заявку</Button>
      </form>
    </Modal>
  );
}
function VerificationHistory({ spaceId }: { spaceId: string }) {
  const data = useLoad<any[]>(
    () => api("/spaces/" + spaceId + "/verification-history"),
    [spaceId],
  );
  return (
    <details>
      <summary>История статуса сообщества</summary>
      {data.error && <p>{data.error}</p>}
      {data.value?.map((h: any, i: number) => (
        <article key={i}>
          <small>{new Date(h.createdAt).toLocaleString()}</small>
          <p>
            {(
              {
                grant: "Выдан",
                revoke: "Отозван",
                suspend: "Приостановлен",
              } as any
            )[h.action] || h.action}{" "}
            · {h.reason}
          </p>
        </article>
      ))}
    </details>
  );
}

function AdminRights({
  admin,
  spaceId,
  onClose,
  onDone,
}: {
  admin: any;
  spaceId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useApp(),
    permissions = JSON.parse(admin.permissions || "{}");
  return (
    <Modal title={"Полномочия · " + admin.displayName} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            p = Object.fromEntries(
              [
                "publish",
                "edit",
                "delete",
                "settings",
                "members",
                "admins",
              ].map((k) => [k, f.get(k) === "on"]),
            );
          try {
            await post("/spaces/" + spaceId + "/admins", {
              action: "add",
              username: admin.username,
              canPublish: p.publish,
              permissions: p,
            });
            onDone();
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      >
        {Object.entries({
          publish: "Публикация",
          edit: "Редактирование",
          delete: "Удаление постов",
          settings: "Оформление и настройки",
          members: "Участники",
          admins: "Назначение администраторов",
        }).map(([k, v]) => (
          <label className="check" key={k}>
            <input
              type="checkbox"
              name={k}
              defaultChecked={
                k === "publish" ? !!admin.canPublish : !!permissions[k]
              }
            />
            {v}
          </label>
        ))}
        <Button>Сохранить полномочия</Button>
      </form>
    </Modal>
  );
}
