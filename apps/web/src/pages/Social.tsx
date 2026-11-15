import { askText, askConfirm } from "../components/dialogs";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  Plus,
  Search,
  MessageCircle,
  Globe2,
  Users,
  Hash,
  Check,
  Sparkles,
  Shield,
  Settings as SettingsIcon,
  Bell,
  Download,
} from "lucide-react";
import type { Space, User, Language } from "../../../../packages/shared/types";
import { api, post, put, patch } from "../services/api";
import {
  useApp,
  Avatar,
  Button,
  Empty,
  Field,
  Modal,
  Loading,
  Tag,
  useLoad,
  date,
} from "../components/UI";
import { languageNames } from "../i18n";
import { Verified } from "../components/Crystal";
import { playSound, type SoundKind } from "../services/sound";
export function Discover({
  onSpace,
  onProfile,
}: {
  onSpace: (s: Space) => void;
  onProfile: (u: User) => void;
}) {
  const { t, toast } = useApp();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const { value, error, refresh } = useLoad<{ spaces: Space[]; users: User[] }>(
    () => api(`/discover?q=${encodeURIComponent(query)}`),
    [query],
  );
  return (
    <div className="page scroll">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ОТКРОЙТЕ ORBIT</span>
          <h1>
            {t("explore")}
            <span className="accent-period">.</span>
          </h1>
          <p>{t("emptyChatsBody")}</p>
        </div>
        <Globe2 size={48} strokeWidth={1} />
      </div>
      <div className="explore-toolbar">
        <div className="search-field">
          <Search size={18} />
          <input
            placeholder={t("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="pills">
          {["all", "people", "group", "channel"].map((f) => (
            <button
              key={f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {t(f as any)}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!value ? (
        <Loading />
      ) : (
        <>
          {["all", "group", "channel"].includes(filter) && (
            <>
              <div className="section-heading">
                <h2>{t("spaces")}</h2>
                <span>
                  {
                    value.spaces.filter(
                      (s) => filter === "all" || s.kind === filter,
                    ).length
                  }
                </span>
              </div>
              <div className="community-grid">
                {value.spaces
                  .filter((s) => filter === "all" || s.kind === filter)
                  .map((s, i) => (
                    <article
                      className={`community-card tone-${i % 4}`}
                      key={s.id}
                    >
                      <div className="community-cover">
                        <span>
                          {s.kind === "channel" ? (
                            <Hash size={32} strokeWidth={1} />
                          ) : (
                            <Users size={32} strokeWidth={1} />
                          )}
                        </span>
                        <Tag>{t(s.kind)}</Tag>
                        <div className="cover-orbit" />
                      </div>
                      <div className="community-body">
                        <h3>
                          {s.title}
                          <Verified value={(s as any).verified} />
                        </h3>
                        <p>{s.description || "@" + s.slug}</p>
                        <div className="community-foot">
                          <span>
                            <Users size={14} />
                            {s.members} {t("members")}
                          </span>
                          <button
                            className="circle-button"
                            title={t("message")}
                            onClick={() => onSpace(s)}
                          >
                            <ArrowUpRight size={19} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
              </div>
              {!value.spaces.length && (
                <div className="empty-inline">
                  {t("noData")} · {t("create")} {t("group").toLowerCase()} /{" "}
                  {t("channel").toLowerCase()}
                </div>
              )}
            </>
          )}
          {["all", "people"].includes(filter) && (
            <>
              <div className="section-heading">
                <h2>{t("people")}</h2>
                <span>{value.users.length}</span>
              </div>
              <div className="people-grid">
                {value.users.map((u) => (
                  <button
                    className="person-card"
                    key={u.id}
                    onClick={() => onProfile(u)}
                  >
                    <Avatar
                      name={u.displayName}
                      src={u.avatar}
                      size={48}
                      ai={u.type === "ai"}
                    />
                    <div>
                      <h3>
                        {u.displayName}
                        <Verified value={u.verified} />
                      </h3>
                      <p>@{u.username}</p>
                      <Tag>
                        {u.presence?.online
                          ? "В сети"
                          : u.presence?.lastSeen
                            ? "Был(а) " +
                              new Date(u.presence.lastSeen).toLocaleDateString()
                            : "Статус скрыт"}
                      </Tag>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
export function NewSpace({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t, toast } = useApp();
  const [kind, setKind] = useState<"dm" | "group" | "channel">("group"),
    [busy, setBusy] = useState(false),
    [members, setMembers] = useState<string[]>([]);
  const { value } = useLoad<{ users: User[] }>(() => api("/discover"));
  return (
    <Modal title={t("newSpace")} onClose={onClose}>
      <div className="pills">
        {(["dm", "group", "channel"] as const).map((k) => (
          <button
            key={k}
            className={kind === k ? "active" : ""}
            onClick={() => {
              setKind(k);
              setMembers([]);
            }}
          >
            {t(k)}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          try {
            const s = await post("/spaces", {
              kind,
              title: kind === "dm" ? "Direct message" : form.get("title"),
              description: form.get("description") || "",
              visibility: form.get("visibility") || "private",
              members,
            });
            onCreated(s.id);
            onClose();
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {kind !== "dm" && (
          <>
            <Field label={t("title")}>
              <input required name="title" maxLength={100} />
            </Field>
            <Field label={t("description")}>
              <textarea name="description" maxLength={2000} />
            </Field>
            <Field label={t("public") + " / " + t("private")}>
              <select name="visibility">
                <option value="public">{t("public")}</option>
                <option value="private">{t("private")}</option>
              </select>
            </Field>
          </>
        )}
        <div className="field" role="group" aria-label={t("members")}>
          <span>{t("members")}</span>
          <div className="member-picker">
            {value?.users.map((u) => (
              <label key={u.id} className="member-select">
                <input
                  type={kind === "dm" ? "radio" : "checkbox"}
                  name="member"
                  value={u.id}
                  checked={members.includes(u.id)}
                  onChange={(e) =>
                    setMembers(
                      kind === "dm"
                        ? [u.id]
                        : e.target.checked
                          ? [...members, u.id]
                          : members.filter((x) => x !== u.id),
                    )
                  }
                />
                <Avatar name={u.displayName} size={30} ai={u.type === "ai"} />
                {u.displayName}
                <small>@{u.username}</small>
              </label>
            ))}
          </div>
        </div>
        <Button
          busy={busy}
          className="primary full"
          disabled={kind === "dm" && members.length !== 1}
        >
          {t("create")}
        </Button>
      </form>
    </Modal>
  );
}
export function Forum() {
  const { t, toast, user, lang } = useApp();
  const [category, setCategory] = useState("all"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [create, setCreate] = useState(false),
    [reply, setReply] = useState("");
  const { value, refresh } = useLoad<any>(() => api("/forum"), []);
  const topic = useLoad<any>(
    () => (selected ? api(`/forum/${selected}`) : Promise.resolve(null)),
    [selected],
  );
  const admin = ["OWNER", "ADMIN", "MODERATOR"].includes(user.role);
  const items = value?.topics.filter(
    (x: any) =>
      (category === "all" || x.category === category) &&
      (x.title + x.body).toLowerCase().includes(query.toLowerCase()),
  );
  async function update(body: any) {
    try {
      await patch(`/forum/${selected}`, body);
      topic.refresh();
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="page scroll">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A SPACE TO BE HEARD</span>
          <h1>
            {t("forum")}
            <span className="accent-period">.</span>
          </h1>
        </div>
        <Button className="primary" onClick={() => setCreate(true)}>
          <Plus size={17} />
          {t("topic")}
        </Button>
      </div>
      {selected ? (
        <>
          <button
            className="text-btn back-link"
            onClick={() => setSelected(null)}
          >
            <ArrowLeft size={15} />
            {t("back")}
          </button>
          {!topic.value ? (
            <Loading />
          ) : (
            <article className="forum-topic">
              <div className="topic-meta">
                <Tag>{t(topic.value.category)}</Tag>
                <Tag>{t(topic.value.status)}</Tag>
                {topic.value.pinned > 0 && <Tag>📌</Tag>}
              </div>
              <h2>{topic.value.title}</h2>
              <div className="author-line">
                <Avatar name={topic.value.displayName} size={32} />
                <span>
                  {topic.value.displayName}{" "}
                  <Verified value={topic.value.verified} />·{" "}
                  {date(topic.value.created_at, lang)}
                </span>
              </div>
              <p className="topic-body">{topic.value.body}</p>
              {admin && (
                <div className="button-row">
                  <Button
                    onClick={() =>
                      update({
                        status:
                          topic.value.status === "closed" ? "open" : "closed",
                      })
                    }
                  >
                    {topic.value.status === "closed" ? t("open") : t("close")}
                  </Button>
                  <Button onClick={() => update({ status: "resolved" })}>
                    {t("resolved")}
                  </Button>
                  <Button
                    onClick={() => update({ pinned: !topic.value.pinned })}
                  >
                    {t("pin")}
                  </Button>
                  {topic.value.appeal &&
                    ["accepted", "rejected"].map((decision) => (
                      <Button
                        key={decision}
                        onClick={() =>
                          update({
                            appealDecision: decision,
                            status: "resolved",
                          })
                        }
                      >
                        {decision === "accepted"
                          ? "Принять обжалование"
                          : "Отклонить обжалование"}
                      </Button>
                    ))}
                </div>
              )}
              {topic.value.author_id === user.id && (
                <Button
                  onClick={async () => {
                    const body = await askText(t("edit"), topic.value.body);
                    if (body) void update({ body });
                  }}
                >
                  {t("edit")}
                </Button>
              )}
              <h3 className="section-heading">
                {topic.value.replies.length} {t("replies")}
              </h3>
              {topic.value.replies.map((r: any) => (
                <div className="forum-reply" key={r.id}>
                  <Avatar name={r.displayName} size={35} />
                  <div>
                    <b>
                      {r.displayName} <Verified value={r.verified} />{" "}
                    </b>
                    <small className="muted">
                      {" "}
                      · {date(r.created_at, lang)}
                    </small>
                    <p>{r.body}</p>
                    <button
                      className="text-btn"
                      onClick={() => setReply(`> ${r.body.slice(0, 300)}\n\n`)}
                    >
                      {t("reply")}
                    </button>
                    {r.author_id === user.id && (
                      <button
                        className="text-btn"
                        onClick={async () => {
                          const body = await askText(t("edit"), r.body);
                          if (body)
                            try {
                              await patch(`/forum/replies/${r.id}`, { body });
                              topic.refresh();
                            } catch (e) {
                              toast((e as Error).message);
                            }
                        }}
                      >
                        {t("edit")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {topic.value.status !== "closed" && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await post(`/forum/${selected}/replies`, { body: reply });
                      setReply("");
                      topic.refresh();
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  <Field label={t("reply")}>
                    <textarea
                      required
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                    />
                  </Field>
                  <Button className="primary">{t("send")}</Button>
                </form>
              )}
            </article>
          )}
        </>
      ) : (
        <>
          <div className="search-field">
            <Search size={18} />
            <input
              placeholder={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="pills category-pills">
            <button
              className={category === "all" ? "active" : ""}
              onClick={() => setCategory("all")}
            >
              {t("all")}
            </button>
            {value?.categories.map((c: string) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={category === c ? "active" : ""}
              >
                {t(c as any)}
              </button>
            ))}
          </div>
          {!value ? (
            <Loading />
          ) : !items.length ? (
            <Empty
              title={t("noTopics")}
              action={
                <Button className="primary" onClick={() => setCreate(true)}>
                  {t("topic")}
                </Button>
              }
            />
          ) : (
            <div className="forum-list">
              {items.map((x: any) => (
                <button
                  className="topic-row"
                  key={x.id}
                  onClick={() => setSelected(x.id)}
                >
                  <div className="topic-icon">
                    <MessageCircle size={23} />
                  </div>
                  <div>
                    <div className="topic-meta">
                      <span>{t(x.category)}</span>
                      {x.pinned > 0 && "📌"}
                      <Tag>{t(x.status)}</Tag>
                    </div>
                    <h3>{x.title}</h3>
                    <p>
                      {x.displayName} · {date(x.updated_at, lang)}
                    </p>
                  </div>
                  <span className="reply-count">
                    {x.replies}
                    <small>{t("replies")}</small>
                  </span>
                  <ArrowUpRight size={19} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {create && (
        <Modal title={t("topic")} onClose={() => setCreate(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const x = await post("/forum", Object.fromEntries(f));
                setSelected(x.id);
                setCreate(false);
                refresh();
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            <Field label={t("category")}>
              <select
                name="category"
                defaultValue={user.status === "banned" ? "appeals" : "general"}
              >
                {value?.categories.map((c: string) => (
                  <option key={c} value={c}>
                    {t(c as any)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("title")}>
              <input name="title" required minLength={3} maxLength={150} />
            </Field>
            <Field label={t("body")}>
              <textarea
                name="body"
                required
                minLength={3}
                maxLength={10000}
                rows={5}
              />
            </Field>
            <Button className="primary full">{t("create")}</Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
