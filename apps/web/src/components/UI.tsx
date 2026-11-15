import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { X, Orbit, ArrowUpRight, LoaderCircle } from "lucide-react";
import type { User, Language } from "../../../../packages/shared/types";
import type { Translate } from "../i18n";
import { OrbitMark } from "./Crystal";
import { createPortal } from "react-dom";
export const Context = createContext<{
  user: User;
  t: Translate;
  lang: Language;
  toast: (s: string) => void;
  refresh: () => void;
  setUser: (u: User) => void;
}>({} as any);
export const useApp = () => useContext(Context);
export function Avatar({
  name = "",
  src,
  size = 42,
  seed = "",
  ai = false,
}: {
  name?: string;
  src?: string | null;
  size?: number;
  seed?: string;
  ai?: boolean;
}) {
  let hash = 0;
  for (const c of seed || name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const colors = [
    "#183c58",
    "#253957",
    "#243655",
    "#382e53",
    "#203e4b",
    "#214347",
  ];
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: colors[Math.abs(hash) % colors.length],
        fontSize: size * 0.32,
      }}
    >
      {src ? (
        <img src={src} alt="" />
      ) : (
        name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toUpperCase() || <Orbit size={size * 0.5} />
      )}{" "}
    </span>
  );
}
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-icon">
        <OrbitMark />
      </span>
      {!small && (
        <span>
          orbit<span className="brand-period">.</span>
        </span>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const { t } = useApp();
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const parent = dialog.current?.closest(".modal-scrim");
    const behind = Array.from(document.body.children).filter(
      (el) => el !== parent && !el.contains(dialog.current),
    );
    const prior = behind.map((el) => ({
      el: el as HTMLElement,
      inert: (el as HTMLElement).inert,
    }));
    prior.forEach((x) => (x.el.inert = true));
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input,select,textarea,a[href],[tabindex="0"]',
        ) || [],
      ).filter((e) => e.offsetParent !== null);
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (
        Array.from(document.querySelectorAll(".modal-scrim")).at(-1) !== parent
      )
        return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const elements = focusables(),
          first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prior.forEach((x) => (x.el.inert = x.inert));
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div className="modal-scrim" onMouseDown={onClose}>
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            className="icon"
            onClick={onClose}
            aria-label={t?.("close") || "Закрыть"}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-art">
        <Orbit size={64} strokeWidth={0.8} />
        <span className="spark one" />
        <span className="spark two" />
      </div>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      <div className="skeleton" />
      <div className="skeleton short" />
    </div>
  );
}
export function VirtualItems({
  children,
  rowHeight = 86,
}: {
  children: ReactNode[];
  rowHeight?: number;
}) {
  const marker = useRef<HTMLDivElement>(null);
  const [window, setWindow] = useState({ start: 0, count: 20 });
  useEffect(() => {
    const container = marker.current?.parentElement;
    if (!container) return;
    const update = () =>
      setWindow({
        start: Math.max(0, Math.floor(container.scrollTop / rowHeight) - 5),
        count: Math.ceil(container.clientHeight / rowHeight) + 10,
      });
    const observer = new ResizeObserver(update);
    observer.observe(container);
    container.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", update);
    };
  }, [rowHeight, children.length]);
  const start = Math.min(window.start, Math.max(0, children.length - 1)),
    end = Math.min(children.length, start + window.count);
  return (
    <>
      <div ref={marker} />
      <div aria-hidden style={{ height: start * rowHeight }} />
      {children.slice(start, end).map((child, i) => (
        <div key={start + i} style={{ height: rowHeight }}>
          {child}
        </div>
      ))}
      <div
        aria-hidden
        style={{ height: (children.length - end) * rowHeight }}
      />
    </>
  );
}
export function Button({
  children,
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`btn ${props.className || ""}`}
    >
      {busy ? <LoaderCircle className="spin" size={16} /> : null}
      {children}
    </button>
  );
}
export function useLoad<T = any>(loader: () => Promise<T>, deps: any[] = []) {
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState("");
  const refresh = () => {
    loader()
      .then((v) => {
        setValue(v);
        setError("");
      })
      .catch((e) => setError(e.message));
  };
  useEffect(refresh, deps);
  return { value, error, refresh, setValue };
}
let displayTimeZone: string | undefined;
export function configureTimeZone(zone?: string) {
  try {
    if (zone) new Intl.DateTimeFormat("en", { timeZone: zone });
    displayTimeZone = zone;
  } catch {
    displayTimeZone = undefined;
  }
}
export function time(value: number, lang: string) {
  return new Date(value).toLocaleTimeString(lang, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: displayTimeZone,
  });
}
export function date(value: number, lang: string) {
  return new Date(value).toLocaleDateString(lang, {
    day: "numeric",
    month: "short",
    timeZone: displayTimeZone,
  });
}
export function Tag({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
