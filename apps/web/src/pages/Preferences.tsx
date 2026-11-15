import { About, DesktopPreferences } from "./About";
import { useState } from "react";
import {
  Paintbrush,
  UserRound,
  Bell,
  Shield,
  Globe,
  Database,
  SlidersHorizontal,
  Check,
  Volume2,
  Monitor,
  Sun,
  Moon,
  Image,
  Eye,
  Layers,
  Sparkles,
} from "lucide-react";
import { Modal, Button, Field, Avatar, useApp } from "../components/UI";
import {
  appearance,
  applyAppearance,
  type Appearance,
} from "../components/Crystal";
import { askConfirm } from "../components/dialogs";
import { patch } from "../services/api";
import { languageNames } from "../i18n";
import { playSound, type SoundKind } from "../services/sound";
export function Preferences({
  onClose,
  onProfile,
}: {
  onClose: () => void;
  onProfile: () => void;
}) {
  const { user, setUser, toast } = useApp();
  const [section, setSection] = useState("appearance"),
    [prefs, setPrefs] = useState(appearance),
    [volume, setVolume] = useState(Number(localStorage.getItem("volume") || 0)),
    [busy, setBusy] = useState(false);
  const entries = [
    ["about", "О проекте", Sparkles],
    ...(user.role === "OWNER"
      ? [["desktop", "Запуск приложения", Monitor] as const]
      : []),
    ["profile", "Профиль", UserRound],
    ["appearance", "Внешний вид", Paintbrush],
    ["notifications", "Уведомления", Bell],
    ["privacy", "Конфиденциальность", Shield],
    ["language", "Язык", Globe],
    ["storage", "Хранилище", Database],
  ] as const;
  function change(next: Partial<Appearance>) {
    const value = { ...prefs, ...next };
    setPrefs(value);
    applyAppearance(value);
  }
  return (
    <Modal title="Настройки Orbit" wide onClose={onClose}>
      <div className="preferences-layout">
        <nav className="preferences-nav">
          {entries.map(([id, label, Icon]) => (
            <button
              className={section === id ? "active" : ""}
              key={id}
              onClick={() => setSection(id)}
            >
              <Icon size={21} />
              {label}
            </button>
          ))}
          <div className="preferences-self">
            <Avatar name={user.displayName} src={user.avatar} size={38} />
            <span>
              {user.displayName}
              <small>@{user.username}</small>
            </span>
          </div>
        </nav>
        <div className="preferences-content">
          <h2>{entries.find((e) => e[0] === section)?.[1]}</h2>
          {section === "about" && <About />}
          {section === "desktop" && <DesktopPreferences />}
          {section === "appearance" && (
            <>
              <p className="muted">
                Ваш Orbit. Настройте глубину, свет и движение.
              </p>
              <section className="panel">
                <h3>
                  <Paintbrush size={19} />
                  Оформление
                </h3>
                <div className="theme-picker">
                  {[
                    ["dark", "Тёмная", Moon],
                    ["light", "Светлая", Sun],
                    ["system", "Системная", Monitor],
                  ].map(([id, label, Icon]: any) => (
                    <button
                      className={prefs.theme === id ? "active" : ""}
                      key={id}
                      onClick={() => change({ theme: id })}
                    >
                      <div className={"theme-preview " + id}>
                        <i />
                        <i />
                        <i />
                      </div>
                      <Icon size={17} />
                      {label}
                      {prefs.theme === id && <Check size={15} />}
                    </button>
                  ))}
                </div>
                <label className="setting-row">
                  <span>
                    <Layers size={20} />
                    <span>
                      <b>Жидкое стекло</b>
                      <small>Прозрачные поверхности и холодные блики</small>
                    </span>
                  </span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={prefs.glass}
                    onChange={(e) => change({ glass: e.target.checked })}
                  />
                </label>
                <Field label={`Размытие · ${prefs.blur}%`}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    disabled={!prefs.glass}
                    value={prefs.blur}
                    onChange={(e) => change({ blur: Number(e.target.value) })}
                  />
                </Field>
                <Field label={`Плотность панелей · ${prefs.opacity}%`}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={prefs.opacity}
                    onChange={(e) =>
                      change({ opacity: Number(e.target.value) })
                    }
                  />
                </Field>
              </section>
              <section className="panel">
                <h3>
                  <Sparkles size={19} />
                  Свет и движение
                </h3>
                <Field label="Качество эффектов">
                  <select
                    value={prefs.quality}
                    onChange={(e) => change({ quality: e.target.value })}
                  >
                    <option value="auto">Автоматически</option>
                    <option value="high">Полное</option>
                    <option value="low">Облегчённое</option>
                  </select>
                </Field>
                <Field label={"Масштаб текста · " + prefs.textScale + "%"}>
                  <input
                    type="range"
                    min="85"
                    max="130"
                    step="5"
                    value={prefs.textScale}
                    onChange={(e) => change({ textScale: +e.target.value })}
                  />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.contrast}
                    onChange={(e) => change({ contrast: e.target.checked })}
                  />
                  Усиленный контраст
                </label>
                <Field label="Анимация фона">
                  <select
                    value={prefs.motion}
                    onChange={(e) => change({ motion: e.target.value })}
                  >
                    <option value="off">Выключена</option>
                    <option value="calm">Спокойная · минутный цикл</option>
                    <option value="dynamic">Динамичная</option>
                  </select>
                </Field>
                <Field label="Акцентное свечение">
                  <div className="accent-picker">
                    {[
                      "#17d9ff",
                      "#448dff",
                      "#a58bff",
                      "#ed9dce",
                      "#6fe8c8",
                    ].map((color) => (
                      <button
                        key={color}
                        aria-label={"Выбрать акцент " + color}
                        className={prefs.accent === color ? "active" : ""}
                        style={{ background: color }}
                        onClick={() => change({ accent: color })}
                      >
                        {prefs.accent === color && <Check size={17} />}
                      </button>
                    ))}
                  </div>
                </Field>
                <p className="muted small-text">
                  Системное уменьшение движения имеет приоритет. В скрытой
                  вкладке анимация приостанавливается.
                </p>
              </section>
            </>
          )}
          {section === "profile" && (
            <section className="panel profile-preference">
              <Avatar name={user.displayName} src={user.avatar} size={100} />
              <h2>{user.displayName}</h2>
              <p className="muted">@{user.username}</p>
              <p>
                Имя, фото, описание и личные данные редактируются в вашем
                профиле.
              </p>
              <Button className="primary" onClick={onProfile}>
                <UserRound size={18} />
                Открыть мой профиль
              </Button>
            </section>
          )}
          {section === "notifications" && (
            <>
              <section className="panel">
                <h3>
                  <Bell size={19} />
                  Уведомления
                </h3>
                <Field label={`Громкость · ${Math.round(volume * 100)}%`}>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={volume}
                    onChange={(e) => {
                      setVolume(Number(e.target.value));
                      localStorage.setItem("volume", e.target.value);
                    }}
                  />
                </Field>
                <label className="setting-row">
                  <span>
                    <Eye size={20} />
                    <span>
                      <b>Предпросмотр сообщений</b>
                      <small>Показывать текст в системном уведомлении</small>
                    </span>
                  </span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={prefs.preview}
                    onChange={(e) => change({ preview: e.target.checked })}
                  />
                </label>
                <Button
                  onClick={async () => {
                    if (!("Notification" in window)) {
                      toast("Браузер не поддерживает системные уведомления");
                      return;
                    }
                    const result = await Notification.requestPermission();
                    toast(
                      result === "granted"
                        ? "Системные уведомления включены"
                        : result === "denied"
                          ? "Уведомления запрещены в настройках браузера"
                          : "Разрешение не предоставлено",
                    );
                  }}
                >
                  Включить системные уведомления
                </Button>
              </section>
              <section className="panel">
                <h3>
                  <Volume2 size={19} />
                  Проверка звуков
                </h3>
                <div className="button-row">
                  {(
                    [
                      ["message", "Сообщение"],
                      ["notification", "Уведомление"],
                      ["sent", "Отправка"],
                      ["error", "Ошибка"],
                      ["success", "Успех"],
                    ] as [SoundKind, string][]
                  ).map(([id, label]) => (
                    <Button
                      key={id}
                      onClick={() => {
                        if (volume === 0) toast("Сначала увеличьте громкость");
                        else playSound(id);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </section>
            </>
          )}
          {section === "privacy" && (
            <section className="panel">
              <h3>
                <Shield size={19} />
                Кто может написать первым
              </h3>
              <p className="muted">
                Настройка проверяется сервером и действует для людей и
                ИИ-участников.
              </p>
              <Field label="Личные сообщения">
                <select
                  defaultValue={(user as any).privacy || "everyone"}
                  disabled={busy}
                  onChange={async (e) => {
                    setBusy(true);
                    try {
                      const updated = await patch("/users/me", {
                        displayName: user.displayName,
                        bio: user.bio,
                        language: user.language,
                        country: user.country,
                        privacy: e.target.value,
                      });
                      setUser(updated);
                      toast("Конфиденциальность обновлена");
                    } catch (e) {
                      toast((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <option value="everyone">Все участники сети</option>
                  <option value="contacts">
                    Только те, на кого я подписан
                  </option>
                </select>
              </Field>
              <div className="notice">
                <Shield size={20} />
                <span>
                  Приложение использует серверное хранение переписки. Сквозное
                  шифрование не заявляется.
                </span>
              </div>
            </section>
          )}
          {section === "language" && (
            <section className="panel">
              <h3>
                <Globe size={19} />
                Язык общения и интерфейса
              </h3>
              <Field label="Предпочитаемый язык">
                <select
                  value={user.language}
                  disabled={busy}
                  onChange={async (e) => {
                    setBusy(true);
                    try {
                      const updated = await patch("/users/me", {
                        displayName: user.displayName,
                        bio: user.bio,
                        language: e.target.value,
                        country: user.country,
                        privacy: (user as any).privacy || "everyone",
                      });
                      setUser(updated);
                      toast("Язык сохранён");
                    } catch (e) {
                      toast((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {Object.entries(languageNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="muted">
                Язык интерфейса не запрещает общаться на других языках.
              </p>
            </section>
          )}
          {section === "storage" && (
            <section className="panel">
              <h3>
                <Database size={19} />
                Локальные данные
              </h3>
              <p>
                Переписки, профили и файлы хранятся на сервере Orbit. Очистка
                браузерного кэша не удаляет сообщения и аккаунты.
              </p>
              <Button
                onClick={async () => {
                  if (
                    !(await askConfirm(
                      "Очистить временный кэш?",
                      "Будут удалены только Cache Storage и временные данные этой вкладки. Настройки оформления и сообщения сохранятся.",
                    ))
                  )
                    return;
                  try {
                    if ("caches" in window)
                      for (const key of await caches.keys())
                        if (key.startsWith("orbit-")) await caches.delete(key);
                    sessionStorage.clear();
                    toast("Временный кэш очищен");
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                Очистить временный кэш
              </Button>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
