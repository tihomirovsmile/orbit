import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Check, AlertTriangle } from "lucide-react";
import { Modal } from "./UI";
function mount<T>(
  render: (finish: (value: T) => void) => React.ReactNode,
): Promise<T> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let done = false;
    const finish = (value: T) => {
      if (done) return;
      done = true;
      root.unmount();
      host.remove();
      resolve(value);
    };
    root.render(render(finish));
  });
}
export function askText(
  title: string,
  initial = "",
  description = "",
  multiline = false,
): Promise<string | null> {
  return mount<string | null>((finish) => {
    function Dialog() {
      const [value, setValue] = useState(initial);
      return (
        <Modal title={title} onClose={() => finish(null)}>
          {description && <p className="muted">{description}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              finish(value);
            }}
          >
            <label className="field">
              <span>{title}</span>
              {multiline ? (
                <textarea
                  autoFocus
                  rows={5}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              ) : (
                <input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                onClick={() => finish(null)}
              >
                Отмена
              </button>
              <button className="btn primary">
                <Check size={16} />
                Подтвердить
              </button>
            </div>
          </form>
        </Modal>
      );
    }
    return <Dialog />;
  });
}
export function askConfirm(
  title: string,
  description: string,
): Promise<boolean> {
  return mount<boolean>((finish) => (
    <Modal title={title} onClose={() => finish(false)}>
      <p className="notice">
        <AlertTriangle size={21} />
        {description}
      </p>
      <div className="dialog-actions">
        <button className="btn" autoFocus onClick={() => finish(false)}>
          Отмена
        </button>
        <button className="btn danger" onClick={() => finish(true)}>
          Подтвердить
        </button>
      </div>
    </Modal>
  ));
}
