import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Search,
  Send,
  Paperclip,
  Smile,
  MoreVertical,
  Reply,
  Check,
  CheckCheck,
  Pin,
  X,
  FileText,
  Settings,
  Megaphone,
  Eye,
  Forward,
  Trash2,
  Pencil,
  Clock,
  Info,
  RefreshCw,
  Shield,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import type { Space, User } from "../../../../packages/shared/types";
import { api, post, patch } from "../services/api";
import {
  useApp,
  Avatar,
  Button,
  Empty,
  Loading,
  Modal,
  Field,
  time,
  useLoad,
} from "../components/UI";
import { StatusIcons } from "../components/Crystal";
import { Countdown } from "./Notify";
import { Verified } from "../components/Crystal";
import { askText, askConfirm } from "../components/dialogs";
import { CommunityProfile, CommunitySettings, MediaViewer } from "./Profiles";
import { playSound } from "../services/sound";
export function Conversation({
  space,
  onBack,
  onProfile,
  socket,
  onRefresh,
}: {
  space: Space;
  onBack: () => void;
  onProfile: (u: User) => void;
  socket: Socket | null;
  onRefresh: () => void;
}) {
  const { user, toast, lang } = useApp();
  const s = space as any,
    channel = s.kind === "channel",
    peer = s.otherUser,
    canPublish =
      s.joined &&
      !s.frozen &&
      !s.deleteAt &&
      !peer?.frozen &&
      !peer?.deleting &&
      (!channel ||
        (s.canManage && s.membership?.canPublish !== 0) ||
        s.isOwner);
  const [messages, setMessages] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [reply, setReply] = useState<any>(null),
    [editing, setEditing] = useState<any>(null),
    [menu, setMenu] = useState(""),
    [info, setInfo] = useState(false),
    [manage, setManage] = useState(false),
    [options, setOptions] = useState(false),
    [files, setFiles] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [typing, setTyping] = useState(""),
    [older, setOlder] = useState(false),
    [forward, setForward] = useState<any>(null),
    [viewer, setViewer] = useState<{ items: any[]; index: number } | null>(
      null,
    ),
    [schedule, setSchedule] = useState(false),
    [ai, setAI] = useState<any>(null),
    [comments, setComments] = useState<any>(null);
  const end = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null),
    follow = useRef(true),
    typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const name = peer?.displayName || s.title,
    avatar = peer?.avatar || s.avatar,
    verified = peer?.verified || s.verified;
  async function load(markRead = true) {
    try {
      const data = await api<any[]>(
        `/spaces/${s.id}/messages?q=${encodeURIComponent(query)}`,
      );
      setMessages((old) =>
        old.length > 100 && !query
          ? [
              ...old.filter(
                (m) => m.createdAt < (data[0]?.createdAt || Infinity),
              ),
              ...data,
            ]
          : data,
      );
      setOlder(data.length === 100);
      setLoading(false);
      setError("");
      if (markRead && s.joined && data.length)
        void post(`/spaces/${s.id}/read`).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }
  useEffect(() => {
    if (s.frozen || s.deleteAt) {
      setMessages([]);
      setTyping("");
      setLoading(false);
      setError(
        s.deleteAt
          ? "Сообщество ожидает удаления"
          : "Сообщество заморожено. Нажмите значок статуса для краткой причины.",
      );
    } else void load();
  }, [query, s.id, s.frozen, s.deleteAt]);
  useEffect(() => {
    socket?.emit("join-space", s.id);
    const update = (d: any) => {
      if (d.spaceId === s.id) void load();
    };
    const read = (d: any) => {
      if (d.spaceId === s.id) void load(false);
    };
    const typed = (d: any) => {
      if (d.spaceId !== s.id) return;
      setTyping(d.active === false ? "" : d.name);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(
        () => setTyping(""),
        Math.min(25000, Math.max(3000, (d.until || 0) - Date.now())),
      );
    };
    socket?.on("messages", update);
    socket?.on("read", read);
    socket?.on("typing", typed);
    return () => {
      socket?.off("messages", update);
      socket?.off("read", read);
      socket?.off("typing", typed);
      clearTimeout(typingTimer.current);
    };
  }, [socket, s.id, query]);
  useEffect(() => {
    if (follow.current && !query)
      end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);
  useEffect(() => {
    if (peer?.type !== "ai") return;
    const update = () => {
      if (!document.hidden)
        api(`/spaces/${s.id}/ai-status`)
          .then(setAI)
          .catch(() => {});
    };
    update();
    const timer = setInterval(update, 10000);
    return () => clearInterval(timer);
  }, [s.id, peer?.type]);
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || (!text.trim() && !files.length)) return;
    setBusy(true);
    try {
      if (editing) {
        await patch("/messages/" + editing.id, { text });
        setEditing(null);
      } else
        await post(`/spaces/${s.id}/messages`, {
          text,
          replyTo: reply?.id,
          mediaIds: files.map((a) => a.id),
        });
      setText("");
      setReply(null);
      setFiles([]);
      follow.current = true;
      playSound("sent");
      await load();
      onRefresh();
      input.current?.focus();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate(action: () => Promise<any>) {
    setMenu("");
    try {
      await action();
      await load(false);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  const openIdentity = () => (peer ? onProfile(peer) : setInfo(true));
  return (
    <div className={"conversation " + (channel ? "channel-view" : "")}>
      <section className="thread">
        <header className="thread-head">
          <button
            className="icon mobile-only"
            onClick={onBack}
            aria-label="Назад"
          >
            <ArrowLeft />
          </button>
          <button className="thread-person" onClick={openIdentity}>
            <Avatar
              name={name}
              src={avatar}
              size={52}
              ai={peer?.type === "ai"}
            />
            <span>
              <h2>
                {name}
                <StatusIcons
                  item={peer || s}
                  targetType={peer ? "user" : "space"}
                />
              </h2>
              <p>
                {typing
                  ? `${typing} печатает…`
                  : peer
                    ? peer.deleting
                      ? "Аккаунт удаляется по запросу через поддержку"
                      : peer.frozen
                        ? "Аккаунт заморожен"
                        : peer.presence?.online
                          ? "В сети"
                          : peer.presence?.lastSeen
                            ? "Был(а) " +
                              new Date(peer.presence.lastSeen).toLocaleString()
                            : "Статус скрыт"
                    : `${s.members} ${channel ? "подписчиков · Канал" : "участников · Группа"}`}
              </p>
            </span>
          </button>
          <div className="head-tools">
            <button
              className="icon"
              aria-label="Поиск по переписке"
              onClick={() => setSearch(!search)}
            >
              <Search size={21} />
            </button>
            {s.canManage && !peer && (
              <button
                className="icon"
                aria-label={channel ? "Настройки канала" : "Настройки группы"}
                title="Настройки сообщества"
                onClick={() => setManage(true)}
              >
                <Settings size={21} />
              </button>
            )}
            <button
              className="icon"
              aria-label="Информация"
              onClick={openIdentity}
            >
              <Info size={21} />
            </button>
            {s.joined && (
              <button
                className="icon"
                aria-label="Действия с чатом"
                onClick={() => setOptions(true)}
              >
                <MoreVertical size={21} />
              </button>
            )}
          </div>
        </header>
        {search && (
          <div className="thread-search">
            <Search size={18} />
            <input
              autoFocus
              value={query}
              placeholder="Найти сообщение…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="icon"
              aria-label="Закрыть поиск"
              onClick={() => {
                setSearch(false);
                setQuery("");
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {messages.some((m) => m.pinned) && (
          <div className="pinned">
            <Pin size={17} />
            <span>
              <b>Закреплённое сообщение</b>
              {messages
                .filter((m) => m.pinned)
                .map((m) => m.text)
                .join(" · ")}
            </span>
          </div>
        )}
        <div
          className="message-history"
          onScroll={(e) => {
            const el = e.currentTarget;
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
          onClick={() => menu && setMenu("")}
        >
          {older && (
            <div className="older-messages">
              <Button
                onClick={async () => {
                  try {
                    const previous = await api<any[]>(
                      `/spaces/${s.id}/messages?before=${messages[0].createdAt}&q=${encodeURIComponent(query)}`,
                    );
                    follow.current = false;
                    setMessages((old) => [...previous, ...old]);
                    setOlder(previous.length === 100);
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                Предыдущие сообщения
              </Button>
            </div>
          )}
          {(s.frozen || s.deleteAt) && (
            <div className="notice">
              <StatusIcons item={s} />
              <p>
                {s.deleteAt
                  ? "Сообщество ожидает удаления"
                  : "Сообщество заморожено"}
              </p>
              {s.deleteAt && <Countdown at={s.deleteAt} />}
            </div>
          )}
          {loading ? (
            <Loading />
          ) : error ? (
            <div className="error recovery-box">
              <h3>Не удалось загрузить переписку</h3>
              <p>{error}</p>
              <Button onClick={() => load()}>
                <RefreshCw size={16} />
                Повторить
              </Button>
            </div>
          ) : !messages.length ? (
            <Empty
              title={channel ? "Первая публикация впереди" : "Здесь пока тихо"}
              body={
                canPublish
                  ? channel
                    ? "Расскажите подписчикам, о чём ваш канал."
                    : "Напишите первое сообщение и начните разговор."
                  : "Новые сообщения появятся здесь."
              }
            />
          ) : (
            <>
              <div className="date-divider">
                <span>
                  {new Date(messages[0].createdAt).toLocaleDateString(lang, {
                    day: "numeric",
                    month: "long",
                  })}
                </span>
              </div>
              {messages.map((m) => {
                const own = !channel && m.senderId === user.id,
                  parent = messages.find((x) => x.id === m.replyTo);
                return (
                  <article
                    key={m.id}
                    className={`message-row ${own ? "own" : ""} ${channel ? "channel-post" : ""}`}
                  >
                    <button
                      className="message-avatar"
                      title={m.displayName}
                      onClick={() =>
                        channel
                          ? setInfo(true)
                          : api<User>("/users/" + m.senderId)
                              .then(onProfile)
                              .catch((e) => toast(e.message))
                      }
                    >
                      <Avatar
                        name={m.displayName}
                        src={m.avatar}
                        size={38}
                        ai={m.type === "ai"}
                      />
                    </button>
                    <div className="message-content">
                      {(channel || (!own && s.kind === "group")) && (
                        <button
                          className="sender-name"
                          onClick={() =>
                            channel
                              ? setInfo(true)
                              : api<User>("/users/" + m.senderId).then(
                                  onProfile,
                                )
                          }
                        >
                          {channel && <Avatar name={m.displayName} src={m.avatar} size={28}/>} {m.displayName}
                          <Verified
                            value={m.verified}
                            type={channel ? "channel" : "user"}
                            metadata={s.verification}
                          />
                        </button>
                      )}
                      <div className="bubble">
                        {m.forwardedFrom && (
                          <span className="forward-label">
                            <Forward size={13} />
                            Пересланное сообщение
                          </span>
                        )}
                        {parent && (
                          <button
                            className="quote"
                            onClick={() => setReply(parent)}
                          >
                            <b>{parent.displayName}</b>
                            <span>{parent.text.slice(0, 150)}</span>
                          </button>
                        )}
                        <div className="message-text">{m.text}</div>
                        {m.attachments.map((a: any, index: number) => (
                          <div className="attachment" key={a.id}>
                            {a.mime.startsWith("image/") ? (
                              <button
                                onClick={() =>
                                  setViewer({ items: m.attachments, index })
                                }
                              >
                                <img
                                  src={"/media/" + a.id}
                                  alt={a.name}
                                  loading="lazy"
                                />
                              </button>
                            ) : (
                              <button
                                className="file-card"
                                onClick={() =>
                                  setViewer({ items: m.attachments, index })
                                }
                              >
                                <FileText size={26} />
                                <span>
                                  {a.name}
                                  <small>{(a.size / 1024).toFixed(1)} КБ</small>
                                </span>
                              </button>
                            )}
                          </div>
                        ))}
                        <div className="message-meta">
                          {m.pinned > 0 && <Pin size={12} />}{" "}
                          {m.editedAt && <span>изм.</span>}
                          {channel && (
                            <>
                              <Eye size={13} />
                              {m.readCount}
                            </>
                          )}
                          <time>{time(m.createdAt, lang)}</time>
                          {own &&
                            (m.readCount ? (
                              <CheckCheck size={15} />
                            ) : (
                              <Check size={15} />
                            ))}
                        </div>
                        <button
                          className="message-menu-button icon"
                          aria-label="Действия с сообщением"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenu(menu === m.id ? "" : m.id);
                          }}
                        >
                          <MoreVertical size={17} />
                        </button>
                        {menu === m.id && (
                          <div
                            className="context-menu"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {(!channel || s.allowedReactions?.length > 0) && (
                              <div className="reaction-picker">
                                {(channel
                                  ? s.allowedReactions
                                  : ["❤", "👍", "🔥", "😂", "🤔", "👀"]
                                ).map((emoji: string) => (
                                  <button
                                    key={emoji}
                                    onClick={() =>
                                      mutate(() =>
                                        post(`/messages/${m.id}/reactions`, {
                                          emoji,
                                        }),
                                      )
                                    }
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                            {canPublish && (
                              <button
                                onClick={() => {
                                  setReply(m);
                                  setMenu("");
                                  input.current?.focus();
                                }}
                              >
                                <Reply size={15} />
                                Ответить
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setForward(m);
                                setMenu("");
                              }}
                            >
                              <Forward size={15} />
                              Переслать
                            </button>
                            {m.canEdit && canPublish && (
                              <button
                                onClick={() => {
                                  setEditing(m);
                                  setText(m.text);
                                  setMenu("");
                                  input.current?.focus();
                                }}
                              >
                                <Pencil size={15} />
                                Редактировать
                              </button>
                            )}
                            {m.canEdit && (
                              <button
                                className="danger"
                                onClick={async () => {
                                  if (
                                    await askConfirm(
                                      "Удалить сообщение?",
                                      "Оно исчезнет из переписки.",
                                    )
                                  )
                                    await mutate(() =>
                                      patch("/messages/" + m.id, {
                                        deleted: true,
                                      }),
                                    );
                                }}
                              >
                                <Trash2 size={15} />
                                Удалить
                              </button>
                            )}
                            {s.canManage && (
                              <button
                                onClick={() =>
                                  mutate(() =>
                                    patch("/messages/" + m.id, {
                                      pinned: !m.pinned,
                                    }),
                                  )
                                }
                              >
                                <Pin size={15} />
                                {m.pinned ? "Открепить" : "Закрепить"}
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                setMenu("");
                                const reason = await askText(
                                  "Причина жалобы",
                                  "",
                                  "Укажите, что именно нарушено.",
                                  true,
                                );
                                if (reason)
                                  await mutate(() =>
                                    post("/reports", {
                                      targetId: m.id,
                                      reason,
                                    }),
                                  );
                              }}
                            >
                              <Shield size={15} />
                              Пожаловаться
                            </button>
                          </div>
                        )}
                      </div>
                      {channel && m.signature && (
                        <small className="post-signature">{m.signature}</small>
                      )}
                      {channel && s.commentsMode !== "none" && (
                        <Button
                          className="comments-link"
                          onClick={() => setComments(m)}
                        >
                          Комментарии · {m.commentsCount || 0}
                        </Button>
                      )}
                      <div className="message-reactions">
                        {m.reactions.map((r: any) => (
                          <button
                            key={r.emoji}
                            className={r.mine ? "mine" : ""}
                            disabled={
                              s.reactionsEnabled === false ||
                              (channel &&
                                !s.allowedReactions?.includes(r.emoji))
                            }
                            onClick={() =>
                              mutate(() =>
                                post(`/messages/${m.id}/reactions`, {
                                  emoji: r.emoji,
                                }),
                              )
                            }
                          >
                            {r.emoji} {r.count}
                          </button>
                        ))}
                        {channel &&
                          s.reactionsEnabled !== false &&
                          s.allowedReactions?.length > 0 &&
                          !m.reactions.length && (
                            <button
                              className="subtle-reaction"
                              onClick={() =>
                                mutate(() =>
                                  post(`/messages/${m.id}/reactions`, {
                                    emoji: s.allowedReactions[0],
                                  }),
                                )
                              }
                            >
                              {s.allowedReactions[0]} Реакция
                            </button>
                          )}
                      </div>
                    </div>
                  </article>
                );
              })}
              <div ref={end} />
            </>
          )}
        </div>
        {peer?.type === "ai" && ["OWNER", "ADMIN"].includes(user.role) && (
          <div className="ai-response-state">
            <span
              className={
                "status-dot " + (ai?.state === "running" ? "live" : "")
              }
            />
            {ai?.simulation === "paused" || ai?.simulation === "stopped"
              ? "Симуляция ИИ на паузе. Сообщения сохраняются до запуска."
              : ai?.state === "queued"
                ? `Ответ в очереди${ai.retryAt ? ". Следующая попытка: " + time(ai.retryAt, lang) : ""}.`
                : ai?.state === "failed"
                  ? ai.error ||
                    "Не удалось получить ответ. Администратор может повторить задание."
                  : ai?.state === "running"
                    ? "Модель готовит ответ…"
                    : "ИИ отвечает по своему расписанию. Не все участники постоянно в сети."}
          </div>
        )}
        {typing && <div className="typing">● ● ● &nbsp;{typing} печатает…</div>}
        {canPublish ? (
          <form className="composer" onSubmit={send}>
            {channel && (
              <div className="publish-as">
                <Avatar name={s.title} src={s.avatar} size={22} />
                <span>
                  Публикация от имени <b>{s.title}</b>
                </span>
              </div>
            )}
            {(reply || editing) && (
              <div className="compose-reply">
                <Reply size={17} />
                <span>
                  <b>{editing ? "Редактирование" : reply.displayName}</b>
                  <p>{(editing || reply).text.slice(0, 120)}</p>
                </span>
                <button
                  type="button"
                  className="icon"
                  aria-label="Отменить ответ"
                  onClick={() => {
                    setReply(null);
                    setEditing(null);
                    setText("");
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            )}
            {files.length > 0 && (
              <div className="pending-files">
                {files.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setFiles(files.filter((f) => f.id !== a.id))}
                  >
                    {a.name}
                    <X size={13} />
                  </button>
                ))}
              </div>
            )}
            <div className="compose-row">
              <input
                hidden
                type="file"
                ref={file}
                accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/*,application/pdf,text/plain,application/zip,.docx,.xlsx,.pptx"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (files.length >= 10) {
                    toast("Не больше десяти вложений");
                    return;
                  }
                  setBusy(true);
                  const form = new FormData();
                  form.append("file", f);
                  try {
                    const asset = await api("/media", {
                      method: "POST",
                      body: form,
                    });
                    setFiles((old) => [...old, asset]);
                  } catch (err) {
                    toast((err as Error).message);
                  } finally {
                    setBusy(false);
                    e.target.value = "";
                  }
                }}
              />
              <button
                className="icon"
                type="button"
                aria-label="Прикрепить файл"
                onClick={() => file.current?.click()}
              >
                <Paperclip size={22} />
              </button>
              <textarea
                ref={input}
                aria-label={channel ? "Текст публикации" : "Сообщение"}
                rows={1}
                maxLength={10000}
                value={text}
                placeholder={
                  channel
                    ? "Публикация от имени канала…"
                    : "Напишите сообщение…"
                }
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height =
                    Math.min(160, e.target.scrollHeight) + "px";
                  if (!channel) socket?.emit("typing", { spaceId: s.id });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                className="icon emoji-toggle"
                type="button"
                title="Добавить эмодзи"
                onClick={() => {
                  setText(text + " 😊");
                  input.current?.focus();
                }}
              >
                <Smile size={22} />
              </button>
              {channel && (
                <button
                  type="button"
                  className="icon"
                  title="Отложенная публикация"
                  onClick={() => setSchedule(true)}
                >
                  <Clock size={20} />
                </button>
              )}
              <button
                className="send-button"
                disabled={busy || (!text.trim() && !files.length)}
                aria-label={channel ? "Опубликовать" : "Отправить"}
              >
                <Send size={21} />
              </button>
            </div>
            <small className="composer-hint">
              Enter — отправить · Shift+Enter — новая строка
            </small>
          </form>
        ) : (
          <div className="composer-join">
            {!s.joined ? (
              <Button
                className="primary"
                onClick={() =>
                  post(`/spaces/${s.id}/join`)
                    .then(onRefresh)
                    .catch((e) => toast(e.message))
                }
              >
                {channel ? "Подписаться на канал" : "Вступить в группу"}
              </Button>
            ) : s.frozen ? (
              <span>Публикации приостановлены администрацией</span>
            ) : (
              <span>
                <Megaphone size={16} /> Публикации от имени канала · Только для
                чтения
              </span>
            )}
          </div>
        )}
      </section>
      {options && (
        <Modal title="Действия с чатом" onClose={() => setOptions(false)}>
          <div className="stack">
            {(
              [
                [
                  "pinned",
                  s.membership?.pinned
                    ? "Открепить диалог"
                    : "Закрепить диалог",
                ],
                [
                  "muted",
                  s.membership?.muted
                    ? "Включить уведомления"
                    : "Выключить уведомления",
                ],
                [
                  "archived",
                  s.membership?.archived
                    ? "Вернуть из архива"
                    : "Переместить в архив",
                ],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                onClick={async () => {
                  try {
                    await patch(`/spaces/${s.id}/preferences`, {
                      [key]: !s.membership?.[key],
                    });
                    setOptions(false);
                    onRefresh();
                    toast("Настройка чата сохранена");
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                {label}
              </Button>
            ))}
            {s.kind !== "dm" && !s.isOwner && (
              <Button
                className="danger"
                onClick={async () => {
                  if (
                    !(await askConfirm(
                      channel ? "Отписаться от канала?" : "Покинуть группу?",
                      "Диалог исчезнет из списка. Для приватного сообщества потребуется приглашение, чтобы вернуться.",
                    ))
                  )
                    return;
                  try {
                    await post(`/spaces/${s.id}/leave`);
                    setOptions(false);
                    onBack();
                    onRefresh();
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                {channel ? "Отписаться от канала" : "Покинуть группу"}
              </Button>
            )}
          </div>
        </Modal>
      )}
      {info && (
        <CommunityProfile
          space={space}
          onClose={() => setInfo(false)}
          onProfile={onProfile}
          onRefresh={onRefresh}
          onManage={() => {
            setInfo(false);
            setManage(true);
          }}
        />
      )}
      {comments && (
        <Comments post={comments} onClose={() => setComments(null)} />
      )}
      {manage && (
        <CommunitySettings
          space={space}
          onClose={() => setManage(false)}
          onRefresh={onRefresh}
        />
      )}{" "}
      {viewer && <MediaViewer {...viewer} onClose={() => setViewer(null)} />}{" "}
      {forward && (
        <ForwardDialog message={forward} onClose={() => setForward(null)} />
      )}{" "}
      {schedule && (
        <Modal title="Отложенная публикация" onClose={() => setSchedule(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                await post(`/spaces/${s.id}/schedule`, {
                  text: f.get("text"),
                  publishAt: new Date(String(f.get("at"))).getTime(),
                });
                setSchedule(false);
                toast("Публикация запланирована");
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            <Field label="Текст">
              <textarea name="text" defaultValue={text} required />
            </Field>
            <Field label="Дата и время">
              <input name="at" type="datetime-local" required />
            </Field>
            <Button className="primary">Запланировать</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function ForwardDialog({
  message,
  onClose,
}: {
  message: any;
  onClose: () => void;
}) {
  const { toast } = useApp();
  const { value } = useLoad<any[]>(() => api("/spaces"));
  return (
    <Modal title="Переслать сообщение" onClose={onClose}>
      <div className="stack">
        {value
          ?.filter((s) => s.kind !== "channel" || s.canManage)
          .map((s) => (
            <button
              className="list-button"
              key={s.id}
              onClick={() =>
                post(`/spaces/${s.id}/messages`, { forwardedFrom: message.id })
                  .then(() => {
                    toast("Сообщение переслано");
                    onClose();
                  })
                  .catch((e) => toast(e.message))
              }
            >
              <Avatar
                name={s.otherUser?.displayName || s.title}
                src={s.avatar || s.otherUser?.avatar}
                size={40}
              />
              {s.otherUser?.displayName || s.title}
            </button>
          ))}
      </div>
    </Modal>
  );
}

function Comments({
  post: message,
  onClose,
}: {
  post: any;
  onClose: () => void;
}) {
  const { toast } = useApp(),
    data = useLoad<any[]>(
      () => api("/messages/" + message.id + "/comments"),
      [message.id],
    ),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <Modal title="Обсуждение публикации" onClose={onClose}>
      <p className="notice">{message.text.slice(0, 300)}</p>
      {data.error && <p className="error">{data.error}</p>}
      {data.value?.map((c) => (
        <article className="comment" key={c.id}>
          <Avatar
            name={c.author?.displayName || "DELETED"}
            src={c.author?.avatar}
            size={30}
          />
          <div>
            <b>{c.author?.displayName || "DELETED"}</b>
            <p>{c.body}</p>
            <small>{new Date(c.created_at).toLocaleString()}</small>
          </div>
        </article>
      ))}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post("/messages/" + message.id + "/comments", {
              body,
              requestId: key,
            });
            setBody("");
            setKey(crypto.randomUUID());
            data.refresh();
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Комментарий">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={10000}
          />
        </Field>
        <Button busy={busy}>Отправить</Button>
      </form>
    </Modal>
  );
}
