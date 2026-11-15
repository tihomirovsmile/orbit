import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, type Socket } from "socket.io-client";
import {
  MessageCircle,
  Compass,
  MessagesSquare,
  SlidersHorizontal,
  Settings,
  Bell,
  Plus,
  Search,
  ArrowUpRight,
  LogOut,
  Menu,
  Radio,
  Users,
  Check,
  X,
  Archive,
  Pin,
  Sparkles,
  WifiOff,
  Github,
} from "lucide-react";
import type { Space, User } from "../../../packages/shared/types";
import { api, post, setCSRF } from "./services/api";
import { translate } from "./i18n";
import {
  Context,
  Brand,
  Avatar,
  Button,
  Loading,
  Modal,
  Tag,
  time,
  configureTimeZone,
  VirtualItems,
} from "./components/UI";
import {
  CrystalBackground,
  Orb,
  Verified,
  appearance,
  applyAppearance,
  OrbitMark,
} from "./components/Crystal";
import { Setup } from "./pages/Setup";
import { Conversation } from "./pages/Messenger";
import { Discover, NewSpace, Forum } from "./pages/Social";
import { UserProfile } from "./pages/Profiles";
import { Preferences } from "./pages/Preferences";
import { Notify, SupportDesk } from "./pages/Notify";
import { StatusIcons } from "./components/Crystal";
import { Admin } from "./pages/Admin";
import { askConfirm } from "./components/dialogs";
import { playSound } from "./services/sound";
import "./styles.css";
applyAppearance(appearance());
const paths: Record<string, string> = {
  chats: "/",
  discover: "/explore",
  forum: "/forum",
  admin: "/admin",
};
const current = () =>
  Object.entries(paths).find(([, path]) => path === location.pathname)?.[0] ||
  "chats";
function App() {
  const [boot, setBoot] = useState<any>(null),
    [bootError, setBootError] = useState(""),
    [user, setUser] = useState<User | null>(null),
    [view, setView] = useState(current),
    [spaces, setSpaces] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [newSpace, setNewSpace] = useState(false),
    [profile, setProfile] = useState<User | null>(null),
    [settings, setSettings] = useState(location.pathname === "/settings"),
    [socket, setSocket] = useState<Socket | null>(null),
    [toast, setToast] = useState(""),
    [notes, setNotes] = useState<any[] | null>(null),
    [unread, setUnread] = useState(0),
    [mobileNav, setMobileNav] = useState(false),
    [connected, setConnected] = useState(false);
  const t = translate(user?.language || "ru"),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function showToast(text: string) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }
  async function refresh() {
    if (!user) return;
    try {
      const [list, notifications] = await Promise.all([
        api<any[]>("/spaces"),
        ["banned", "deletion_pending"].includes(user.status)
          ? Promise.resolve([])
          : api<any[]>("/notifications"),
      ]);
      setSpaces(list);
      setSelected((old: any) =>
        old
          ? list.find((s) => s.id === old.id) || (old.joined ? null : old)
          : null,
      );
      setUnread(notifications.filter((n) => !n.read_at).length);
    } catch (e) {
      showToast((e as Error).message);
    }
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refresh(), 250);
  }
  async function bootstrap() {
    try {
      const data = await api("/bootstrap");
      setBoot(data);
      setUser(data.user);
      setCSRF(data.csrf || "");
      configureTimeZone(data.network.timezone);
      setBootError("");
      if (["banned", "deletion_pending"].includes(data.user?.status)) {
        setView("chats");
        setSelected({ id: "notify", title: "Notify" });
      }
      const q = new URLSearchParams(location.search);
      if (data.user && q.get("invite")) {
        const [id, token] = q.get("invite")!.split(":");
        await post(`/spaces/${id}/join`, { invite: token });
        history.replaceState(null, "", location.pathname);
      }
      if (data.user && q.get("user"))
        setProfile(await api("/users/" + q.get("user")));
      if (data.user && q.get("space")) {
        const s = await api("/spaces/" + q.get("space") + "/profile");
        setSelected(s);
        setView("chats");
      }
    } catch (e) {
      setBootError((e as Error).message);
    }
  }
  useEffect(() => {
    void bootstrap();
    return () => {
      clearTimeout(toastTimer.current);
      clearTimeout(refreshTimer.current);
    };
  }, []);
  useEffect(() => {
    if (location.pathname !== paths[view])
      history.pushState(null, "", paths[view]);
    setMobileNav(false);
  }, [view]);
  useEffect(() => {
    const update = () => setView(current());
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.scene =
      view === "chats" && !selected ? "home" : "simple";
  }, [view, selected?.id]);
  useEffect(() => {
    document.documentElement.lang = user?.language || "ru";
  }, [user?.language]);
  useEffect(() => {
    if (!user) return;
    void refresh();
    const s = io({ transports: ["websocket", "polling"] });
    setSocket(s);
    s.on("connect", () => {
      setConnected(true);
      scheduleRefresh();
    });
    const presence = setInterval(() => {
      if (!document.hidden) s.emit("presence");
    }, 30000);
    s.on("disconnect", () => setConnected(false));
    s.on("space-removed", ({ spaceId }) => {
      setSelected((old: any) => (old?.id === spaceId ? null : old));
      scheduleRefresh();
    });
    s.on("account-status", () => {
      void bootstrap();
      scheduleRefresh();
    });
    s.on("notify-event", scheduleRefresh);
    s.on("refresh", scheduleRefresh);
    s.on("messages", scheduleRefresh);
    s.on("read", scheduleRefresh);
    s.on("network", () =>
      api("/bootstrap")
        .then((b) => {
          setBoot(b);
          configureTimeZone(b.network.timezone);
        })
        .catch(() => {}),
    );
    s.on("simulation", () =>
      api("/bootstrap")
        .then((b) =>
          setBoot((old: any) => ({ ...old, simulation: b.simulation })),
        )
        .catch(() => {}),
    );
    s.on("notification", (note) => {
      scheduleRefresh();
      if (
        document.hidden &&
        "Notification" in window &&
        Notification.permission === "granted"
      )
        new Notification(boot.network.name || "Orbit", {
          body: appearance().preview ? note.text : "Новое уведомление в Orbit",
        });
      playSound(note.kind === "message" ? "message" : "notification");
    });
    return () => {
      clearInterval(presence);
      s.disconnect();
      clearTimeout(refreshTimer.current);
    };
  }, [user?.id]);
  function openSpace(s: any) {
    setSelected(s);
    setView("chats");
    setMobileNav(false);
    scheduleRefresh();
  }
  async function openId(id: string) {
    try {
      const list = await api<any[]>("/spaces");
      setSpaces(list);
      const s =
        list.find((s) => s.id === id) || (await api(`/spaces/${id}/profile`));
      openSpace(s);
    } catch (e) {
      showToast((e as Error).message);
    }
  }
  async function direct(u: User) {
    try {
      const result = await post("/spaces", {
        kind: "dm",
        title: "Личная переписка",
        members: [u.id],
      });
      await openId(result.id);
      setProfile(null);
    } catch (e) {
      showToast((e as Error).message);
    }
  }
  if (!boot)
    return (
      <>
        <CrystalBackground />
        <div className="boot-loader">
          <Brand />
          {bootError ? (
            <>
              <p className="error">{bootError}</p>
              <Button onClick={bootstrap}>Повторить подключение</Button>
            </>
          ) : (
            <Loading />
          )}
        </div>
      </>
    );
  if (!user)
    return (
      <>
        <CrystalBackground />
        <Setup bootstrap={boot} onDone={bootstrap} />
      </>
    );
  const isAdmin = ["OWNER", "ADMIN", "MODERATOR", "SUPPORT"].includes(
      user.role,
    ),
    banned = ["banned", "deletion_pending"].includes(user.status),
    routes = [
      ["chats", "Сообщения", MessageCircle],
      ["discover", "Обзор", Compass],
      ["forum", "Форум", MessagesSquare],
      ...(isAdmin ? [["admin", "Управление", SlidersHorizontal]] : []),
    ];
  const filtered = spaces
    .filter(
      (s) =>
        (filter === "archive"
          ? s.membership?.archived
          : !s.membership?.archived) &&
        (filter === "all" ||
          filter === "archive" ||
          (filter === "ai" && s.otherUser?.type === "ai") ||
          s.kind === filter) &&
        (s.otherUser?.displayName || s.title)
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.membership?.pinned || 0) - Number(a.membership?.pinned || 0),
    );
  const active =
    (selected && spaces.find((s) => s.id === selected.id)) || selected;
  return (
    <Context.Provider
      value={{
        user,
        t,
        lang: user.language,
        toast: showToast,
        refresh,
        setUser,
      }}
    >
      <CrystalBackground />
      <div
        className={`app-shell ${view === "chats" ? "chat-view" : ""} ${selected ? "has-chat" : ""} ${mobileNav ? "nav-open" : ""} ${view === "admin" ? "admin-shell" : ""}`}
      >
        <nav className="rail">
          <button
            className="rail-brand"
            title={boot.network.name || "Orbit"}
            onClick={() => {
              setView("chats");
              setSelected(null);
            }}
          >
            {boot.network.logo ? (
              <img
                className="network-logo"
                src={boot.network.logo}
                alt={boot.network.name}
              />
            ) : (
              <Brand small />
            )}
          </button>
          <div className="rail-links">
            {routes
              .filter((r) => !banned || r[0] === "chats")
              .map(([id, label, Icon]: any) => (
                <button
                  key={id}
                  className={"rail-button " + (view === id ? "active" : "")}
                  onClick={() => setView(id)}
                  title={label}
                >
                  <Icon size={25} strokeWidth={1.75} />
                  <span>{label}</span>
                  {id === "chats" && unread > 0 && <i />}
                </button>
              ))}
          </div>
          <div className="rail-bottom">
            <a
              className="rail-button"
              title="GitHub · открытый код Orbit"
              aria-label="GitHub · открытый код Orbit"
              href="https://github.com/tihomirovsmile/orbit"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github size={23} />
              <span>GitHub</span>
            </a>
            <button
              className="rail-button"
              title="Уведомления"
              onClick={() =>
                api<any[]>("/spaces")
                  .then((list) =>
                    openSpace(
                      list.find((s) => s.id === "notify") || {
                        id: "notify",
                        title: "Notify",
                      },
                    ),
                  )
                  .catch((e) => showToast(e.message))
              }
            >
              <Bell size={24} />
              <span>Уведомления</span>
              {unread > 0 && <i />}
            </button>
            <button
              className="rail-button"
              title="Настройки"
              disabled={banned}
              onClick={() => {
                setSettings(true);
                setMobileNav(false);
              }}
            >
              <Settings size={24} />
              <span>Настройки</span>
            </button>
            <button
              className="rail-profile"
              title="Мой профиль"
              disabled={banned}
              onClick={() => setProfile(user)}
            >
              <Avatar name={user.displayName} src={user.avatar} size={44} />
            </button>
            <button
              className="rail-button logout"
              title="Выйти"
              onClick={async () => {
                if (
                  !(await askConfirm(
                    "Выйти из Orbit?",
                    "Ваша переписка и настройки сохранятся.",
                  ))
                )
                  return;
                try {
                  await post("/auth/logout");
                  setUser(null);
                  setSelected(null);
                  await bootstrap();
                } catch (e) {
                  showToast((e as Error).message);
                }
              }}
            >
              <LogOut size={19} />
              <span>Выйти</span>
            </button>
          </div>
        </nav>
        <header className="mobile-top">
          <button
            className="icon"
            aria-label="Открыть навигацию"
            onClick={() => setMobileNav(!mobileNav)}
          >
            <Menu size={23} />
          </button>
          <Brand />
          <button
            className="icon"
            aria-label="Уведомления"
            onClick={() => openSpace({ id: "notify", title: "Notify" })}
          >
            <Bell size={22} />
          </button>
        </header>
        {view === "chats" ? (
          <>
            <aside className="chat-sidebar">
              <header className="sidebar-heading">
                <div>
                  <h1>Сообщения</h1>
                  <p>Ваши чаты, контакты и каналы</p>
                </div>
                <button
                  className="new-chat icon"
                  aria-label="Новый разговор"
                  title="Новый разговор"
                  disabled={banned}
                  onClick={() => setNewSpace(true)}
                >
                  <Plus size={26} />
                </button>
              </header>
              <div className="sidebar-search search-field">
                <Search size={21} />
                <input
                  aria-label="Поиск чатов"
                  placeholder="Поиск по чатам…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <kbd>⌕</kbd>
              </div>
              <div className="chat-filters">
                {[
                  ["all", "Все"],
                  ["dm", "Личные"],
                  ["group", "Группы"],
                  ["channel", "Каналы"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={filter === id ? "active" : ""}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                    {id === "all" && <span>{spaces.length}</span>}
                  </button>
                ))}
              </div>
              <div className="chat-list">
                {filtered.length ? (
                  <VirtualItems rowHeight={88}>
                    {filtered.map((s) => (
                      <button
                        className={
                          "chat-item " +
                          (s.deleteAt ? "deleting " : "") +
                          (active?.id === s.id ? "active" : "")
                        }
                        key={s.id}
                        onClick={() => openSpace(s)}
                      >
                        <Avatar
                          name={s.otherUser?.displayName || s.title}
                          src={s.otherUser?.avatar || s.avatar}
                          size={54}
                          ai={s.otherUser?.type === "ai"}
                        />
                        <div className="chat-summary">
                          <div>
                            <h3>
                              {s.kind === "channel" ? (
                                <Radio size={15} />
                              ) : s.kind === "group" ? (
                                <Users size={15} />
                              ) : null}
                              {s.otherUser?.displayName || s.title}
                              <StatusIcons
                                item={s.otherUser || s}
                                targetType={s.otherUser ? "user" : "space"}
                              />
                            </h3>
                            <time>
                              {s.lastAt ? time(s.lastAt, user.language) : ""}
                            </time>
                          </div>
                          <p>
                            {s.lastText ||
                              s.description ||
                              (s.kind === "channel"
                                ? "Пока нет публикаций"
                                : "Напишите первое сообщение")}
                          </p>
                        </div>
                        {s.membership?.pinned > 0 && (
                          <Pin className="chat-pin" size={12} />
                        )}{" "}
                        {!!s.unread && (
                          <span className="unread-count">
                            {s.unread > 99 ? "99+" : s.unread}
                          </span>
                        )}
                      </button>
                    ))}
                  </VirtualItems>
                ) : (
                  <div className="sidebar-empty">
                    <MessageCircle size={36} strokeWidth={1.25} />
                    <h3>
                      {query ? "Ничего не найдено" : "Пока нет разговоров"}
                    </h3>
                    <p>
                      {query
                        ? "Попробуйте другое имя или название"
                        : "Найдите собеседника или создайте своё сообщество"}
                    </p>
                    <button onClick={() => setView("discover")}>
                      Открыть обзор
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                )}
              </div>
              <div className="sidebar-utilities">
                <button
                  className={filter === "ai" ? "active" : ""}
                  onClick={() => setFilter("all")}
                >
                  <Sparkles size={16} />
                  Все контакты
                </button>
                <button
                  className={filter === "archive" ? "active" : ""}
                  onClick={() =>
                    setFilter(filter === "archive" ? "all" : "archive")
                  }
                >
                  <Archive size={16} />
                  Архив
                </button>
              </div>
              <footer className="sidebar-footer">
                <span className={"status-dot " + (connected ? "live" : "")} />
                {boot.network.name || "Orbit"}
                <small>
                  {connected ? "Соединение установлено" : "Переподключение…"}
                </small>
              </footer>
            </aside>
            <main className="main-content glass-main">
              {active?.id === "notify" || banned ? (
                <Notify onBack={() => setSelected(null)} />
              ) : active ? (
                <Conversation
                  key={active.id}
                  space={active}
                  onBack={() => setSelected(null)}
                  onProfile={setProfile}
                  socket={socket}
                  onRefresh={refresh}
                />
              ) : (
                <section className="welcome-empty">
                  <div className="welcome-top">
                    <span>
                      <OrbitMark />
                      Orbit
                    </span>
                    <small>ЛЮДИ · ИДЕИ · СООБЩЕСТВА</small>
                    <Tag tone={connected ? "green" : ""}>
                      <span
                        className={"status-dot " + (connected ? "live" : "")}
                      />
                      {connected ? "Подключено" : "Нет связи"}
                    </Tag>
                  </div>
                  <div className="welcome-center">
                    <Orb />
                    <span className="eyebrow">ВСЕГДА НА СВЯЗИ</span>
                    <h1>
                      Общение без <em>границ.</em>
                    </h1>
                    <p>
                      Найдите собеседника, создайте группу или откройте свой
                      канал.
                      <br />
                      Общайтесь, делитесь, развивайтесь вместе.
                    </p>
                    <div className="button-row">
                      <Button
                        className="primary"
                        onClick={() => setNewSpace(true)}
                      >
                        <Plus size={23} />
                        Новый чат
                      </Button>
                      <Button onClick={() => setView("discover")}>
                        <Compass size={21} />
                        Обзор
                      </Button>
                    </div>
                  </div>
                  <footer className="welcome-bottom">
                    <span>Orbit · ваше пространство для общения</span>
                    <span>
                      <ShieldLabel /> Данные сохраняются на сервере
                    </span>
                  </footer>
                </section>
              )}
            </main>
          </>
        ) : (
          <main className="main-content full-main">
            {view === "discover" ? (
              <Discover onSpace={openSpace} onProfile={setProfile} />
            ) : view === "forum" ? (
              <Forum />
            ) : user.role === "SUPPORT" ? (
              <div className="admin-page scroll">
                <SupportDesk />
              </div>
            ) : (
              <Admin />
            )}
          </main>
        )}
        {!connected && (
          <div className="connection-warning">
            <WifiOff size={15} />
            Связь прервана. Пробуем подключиться…
          </div>
        )}
        {boot.simulation?.mode === "test" && (
          <div className="global-test-badge">
            Синтетический тест · без запросов к LLM
          </div>
        )}
      </div>
      {settings && (
        <Preferences
          onClose={() => setSettings(false)}
          onProfile={() => {
            setSettings(false);
            setProfile(user);
          }}
        />
      )}
      {newSpace && (
        <NewSpace onClose={() => setNewSpace(false)} onCreated={openId} />
      )}{" "}
      {profile && (
        <UserProfile
          profile={profile}
          onClose={() => setProfile(null)}
          onMessage={direct}
          onOpenSpace={openId}
        />
      )}{" "}
      {notes && (
        <Modal title="Уведомления" onClose={() => setNotes(null)}>
          <Button
            onClick={() =>
              post("/notifications/read").then(() => {
                setNotes(notes.map((n) => ({ ...n, read_at: Date.now() })));
                setUnread(0);
              })
            }
          >
            <Check size={17} />
            Прочитать все
          </Button>
          {!notes.length ? (
            <div className="empty">
              <Bell size={40} />
              <h2>Пока тихо</h2>
              <p>Новые сообщения и события появятся здесь.</p>
            </div>
          ) : (
            <div className="notification-list">
              {notes.map((n) => (
                <button
                  className={n.read_at ? "read" : ""}
                  key={n.id}
                  onClick={() => {
                    if (spaces.some((s) => s.id === n.target))
                      void openId(n.target);
                    else if (n.kind === "forum" || n.kind === "moderation")
                      setView("forum");
                    setNotes(null);
                  }}
                >
                  <span className="notification-dot" />
                  <div>
                    <b>
                      {n.kind === "message"
                        ? "Новое сообщение"
                        : n.kind === "moderation"
                          ? "Решение модерации"
                          : n.kind === "forum"
                            ? "Ответ на форуме"
                            : "Событие Orbit"}
                    </b>
                    <p>{n.text}</p>
                    <small>
                      {new Date(n.created_at).toLocaleString(user.language)}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast("")}>
            <X size={17} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
function ShieldLabel() {
  return <Check size={14} />;
}
createRoot(document.getElementById("root")!).render(<App />);
