import { useEffect, useState } from "react";
import { Check, MessageCircle } from "lucide-react";
import { Modal, Button } from "./UI";
import { api } from "../services/api";
export function Verified({
  value,
  type = "user",
  targetId,
  targetType = "user",
  metadata,
}: {
  value?: number | boolean;
  type?: string;
  targetId?: string;
  targetType?: "user" | "space";
  metadata?: any;
}) {
  const [info, setInfo] = useState<any>(null);
  const kind =
    metadata?.type === "orbit" || type === "orbit"
      ? "orbit"
      : type === "user"
        ? "user"
        : "channel";
  return value ? (
    <>
      <span
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.currentTarget.click();
        }}
        className={"status-badge " + (metadata?.categoryId || "") + " " + kind}
        title={
          kind === "orbit"
            ? "Официальный источник Orbit"
            : kind === "user"
              ? "Статус получен по подтверждённому каналу"
              : "Сообщество подтверждено администрацией Orbit"
        }
        onClick={(e) => {
          e.stopPropagation();
          if (targetId)
            api("/status/" + targetType + "/" + targetId)
              .then(setInfo)
              .catch(() =>
                setInfo({
                  verification: metadata || { active: true, type: kind },
                }),
              );
          else
            setInfo({ verification: metadata || { active: true, type: kind } });
        }}
      >
        <img src={"/assets/status/" + kind + ".jpg"} alt="Подтверждено" />
      </span>
      {info && <StatusDialog info={info} onClose={() => setInfo(null)} />}
    </>
  ) : null;
}
export function StatusIcons({
  item,
  targetType = "space",
}: {
  item: any;
  targetType?: "user" | "space";
}) {
  const [info, setInfo] = useState<any>(null),
    frozen = item.frozen || item.status === "banned",
    deleting = item.deleteAt || item.deletionAt;
  return (
    <>
      {(!!item.verified || item.system) && (
        <Verified
          value
          type={
            item.system ? "orbit" : targetType === "user" ? "user" : "channel"
          }
          metadata={item.verification}
          targetId={item.system ? undefined : item.id}
          targetType={targetType}
        />
      )}{" "}
      {(frozen || deleting) && (
        <span
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.currentTarget.click();
          }}
          className="status-badge"
          title={
            frozen ? "Аккаунт или сообщество заморожено" : "Ожидает удаления"
          }
          onClick={(e) => {
            e.stopPropagation();
            api("/status/" + targetType + "/" + item.id)
              .then(setInfo)
              .catch(() =>
                setInfo({
                  frozen,
                  deleteAt: deleting,
                  reason: "Информация временно недоступна",
                }),
              );
          }}
        >
          <img
            src={"/assets/status/" + (frozen ? "freeze" : "removing") + ".jpg"}
            alt={frozen ? "Заморожено" : "Удаляется"}
          />
        </span>
      )}
      {info && <StatusDialog info={info} onClose={() => setInfo(null)} />}
    </>
  );
}
function StatusDialog({ info, onClose }: { info: any; onClose: () => void }) {
  const v = info.verification;
  const [remaining, setRemaining] = useState(
    Math.max(0, (info.deleteAt || 0) - (info.serverNow || Date.now())),
  );
  useEffect(() => {
    const start = Date.now(),
      base = info.serverNow || start;
    if (!info.deleteAt) return;
    const timer = setInterval(
      () =>
        setRemaining(Math.max(0, info.deleteAt - base - (Date.now() - start))),
      250,
    );
    return () => clearInterval(timer);
  }, [info.deleteAt, info.serverNow]);
  return (
    <Modal
      title={
        info.deleteAt
          ? "Удаление"
          : info.frozen
            ? "Заморозка"
            : "Подтверждённый источник"
      }
      onClose={onClose}
    >
      {info.deleteAt ? (
        <>
          <p>
            Удаление запущено владельцем. Отмена доступна до указанного сервером
            срока.
          </p>
          <p>{new Date(info.deleteAt).toLocaleString()}</p>
          <strong className="countdown" role="timer">
            {Math.floor(remaining / 60000)}:
            {String(Math.ceil(remaining / 1000) % 60).padStart(2, "0")}
          </strong>
        </>
      ) : info.frozen ? (
        <>
          <p>{info.reason || "Аккаунт или сообщество заморожено."}</p>
          {info.expiresAt > 0 && (
            <p>Срок: до {new Date(info.expiresAt).toLocaleString()}</p>
          )}
          <p>
            Работа возобновится после отмены действующих решений или окончания
            срока. Владелец может обжаловать решение через Notify. Статус
            верификации проверяется отдельно.
          </p>
        </>
      ) : (
        <>
          <img
            className="status-preview"
            src={
              "/assets/status/" +
              (v?.type === "orbit"
                ? "orbit"
                : v?.type === "derived" || v?.type === "user"
                  ? "user"
                  : "channel") +
              ".jpg"
            }
            alt=""
          />
          <p>
            {v?.type === "derived" || v?.type === "user"
              ? "Галочка автоматически получена по действующему подтверждённому каналу. Она не подтверждает личность человека."
              : v?.type === "orbit"
                ? "Официальный источник, связанный с социальной сетью Orbit."
                : "Данное сообщество подтверждено администрацией Orbit."}
          </p>
          {v?.category && <p>Категория: {v.category}</p>}
          {v?.country && (
            <p>
              Страна финансирования:{" "}
              {new Intl.DisplayNames(["ru"], { type: "region" }).of(v.country)}
            </p>
          )}
        </>
      )}
      <Button onClick={onClose}>Понятно</Button>
    </Modal>
  );
}
export function OrbitMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={"orbit-mark " + className}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="18" stroke="currentColor" strokeWidth="2" />
      <ellipse
        cx="32"
        cy="32"
        rx="31"
        ry="10"
        transform="rotate(-38 32 32)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="48" cy="13" r="3" fill="currentColor" />
    </svg>
  );
}
export function Orb() {
  return (
    <div className="crystal-orb" aria-hidden="true">
      <i className="orb-ring r1" />
      <i className="orb-ring r2" />
      <div className="orb-globe">
        <MessageCircle strokeWidth={1.3} size={60} />
      </div>
      <span className="satellite" />
      <span className="satellite second" />
    </div>
  );
}
export function CrystalBackground() {
  useEffect(() => {
    let frame = 0;
    const pointer = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        document.documentElement.style.setProperty(
          "--shine-x",
          (e.clientX / innerWidth) * 100 + "%",
        );
        document.documentElement.style.setProperty(
          "--shine-y",
          (e.clientY / innerHeight) * 100 + "%",
        );
        frame = 0;
      });
    };
    document.addEventListener("pointermove", pointer, { passive: true });
    const update = () =>
      (document.documentElement.dataset.hidden = String(document.hidden));
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.removeEventListener("pointermove", pointer);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="crystal-background" aria-hidden="true">
      <div className="aurora a1" />
      <div className="aurora a2" />
      <svg
        className="liquid-top"
        viewBox="0 0 1600 160"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="liquid" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#0384bd" stopOpacity=".18" />
            <stop offset=".65" stopColor="#12cefa" stopOpacity=".3" />
            <stop offset="1" stopColor="#99f9ff" stopOpacity=".7" />
          </linearGradient>
        </defs>
        <path
          d="M0 0H1600V18C1510 54 1450 6 1360 25S1210 78 1110 30 990 8 900 26 790 2 710 30 570 65 480 26 320 6 260 31 110 15 0 46Z"
          fill="url(#liquid)"
        />
        <path
          d="M0 46C110 15 180 63 260 31S390-13 480 26 630 58 710 30 820 44 900 26 1010-18 1110 30 1270 44 1360 25 1510 54 1600 18"
          stroke="#57ddff"
          strokeOpacity=".6"
          fill="none"
        />
      </svg>
      {[9, 27, 42, 63, 79, 94].map((x, i) => (
        <i
          className={"liquid-drop d" + i}
          key={x}
          style={{ left: x + "%", animationDelay: -i * 7 + "s" }}
        />
      ))}
    </div>
  );
}
export type Appearance = {
  theme: string;
  glass: boolean;
  blur: number;
  opacity: number;
  motion: string;
  accent: string;
  preview: boolean;
  quality: string;
  contrast: boolean;
  textScale: number;
};
export const appearanceDefaults: Appearance = {
  theme: "dark",
  glass: true,
  blur: 65,
  opacity: 80,
  motion: "calm",
  accent: "#17d9ff",
  preview: true,
  quality: "auto",
  contrast: false,
  textScale: 100,
};
export function appearance(): Appearance {
  try {
    return {
      ...appearanceDefaults,
      ...JSON.parse(localStorage.getItem("orbit-appearance") || "{}"),
    };
  } catch {
    return appearanceDefaults;
  }
}
export function applyAppearance(value: Appearance) {
  const root = document.documentElement;
  root.dataset.theme =
    value.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : value.theme;
  root.dataset.motion = value.motion;
  const cores = navigator.hardwareConcurrency || 4;
  root.dataset.quality =
    value.quality === "auto" ? (cores <= 4 ? "low" : "high") : value.quality;
  root.dataset.contrast = String(value.contrast);
  root.style.setProperty("--text-scale", String(value.textScale / 100));
  root.style.fontSize = value.textScale + "%";
  root.dataset.glass = String(value.glass);
  root.style.setProperty(
    "--glass-blur",
    value.glass ? value.blur * 0.3 + "px" : "0px",
  );
  root.style.setProperty(
    "--panel-opacity",
    String(0.5 + value.opacity * 0.0048),
  );
  root.style.setProperty("--cyan", value.accent);
  localStorage.setItem("orbit-appearance", JSON.stringify(value));
}
