import { useState } from "react";
import { Button, Field, Modal, useApp } from "../components/UI";
import { post } from "../services/api";
const labels: Record<string, string> = {
  freeze: "Заморозить",
  warn: "Предупредить",
  restrict: "Ограничить сообщения",
  propose_deletion: "Предложить удаление",
  approve_deletion: "Назначить удаление через час",
  ai_pause: "Приостановить ИИ",
  ai_resume: "Возобновить ИИ",
  role: "Изменить роль",
};
export function BulkActions({
  targets,
  onClose,
  onDone,
}: {
  targets: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { user, toast } = useApp();
  const [action, setAction] = useState("warn"),
    [review, setReview] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const actions = [
    "warn",
    "restrict",
    "freeze",
    "propose_deletion",
    ...(user.role === "OWNER"
      ? [
          "approve_deletion",
          ...(targets.every((x) => x.type === "ai")
            ? ["ai_pause", "ai_resume"]
            : []),
          ...(targets.every((x) => x.type === "human") ? ["role"] : []),
        ]
      : []),
  ];
  return (
    <Modal
      title={`Массовое действие · ${targets.length} аккаунтов`}
      onClose={busy ? () => {} : onClose}
    >
      <div className="bulk-targets">
        {targets.map((x) => (
          <div key={x.id}>
            <b>{x.displayName}</b> @{x.username}
            {x.ownedCommunities ? ` · сообществ: ${x.ownedCommunities}` : ""}
          </div>
        ))}
      </div>
      {result ? (
        <>
          <p>
            Выполнено: {result.results.filter((r: any) => r.ok).length} из{" "}
            {targets.length}.
          </p>
          {result.results
            .filter((r: any) => !r.ok)
            .map((r: any) => (
              <p className="error" key={r.targetId}>
                {targets.find((x) => x.id === r.targetId)?.displayName}:{" "}
                {r.error}
              </p>
            ))}
          <Button className="primary" onClick={onDone}>
            Готово
          </Button>
        </>
      ) : review ? (
        <>
          <h3>{labels[review.action]}</h3>
          <p>{review.reason}</p>
          <p>
            Срок:{" "}
            {review.durationHours
              ? `${review.durationHours} ч.`
              : "до пересмотра"}
            {review.role ? ` · новая роль: ${review.role}` : ""}.
          </p>
          {action === "freeze" && (
            <p className="warning">
              Заморозка затронет также сообщества этих владельцев. Отмена
              выполняется отдельно для исходного решения каждого аккаунта.
            </p>
          )}
          {action === "approve_deletion" && (
            <p className="warning">
              Аккаунты будут ожидать удаления один час. Владельцы сообществ
              сначала должны передать или удалить сообщества. Пользователь может
              отменить удаление через Notify.
            </p>
          )}
          <p>
            Права проверяются для каждого аккаунта. Доступные действия будут
            выполнены, причины отказов появятся в результате.
          </p>
          <div className="button-row">
            <Button disabled={busy} onClick={() => setReview(null)}>
              Изменить
            </Button>
            <Button
              busy={busy}
              className="primary"
              onClick={async () => {
                setBusy(true);
                try {
                  setResult(await post("/admin/actions/bulk", review));
                } catch (e) {
                  toast((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Применить к {targets.length} аккаунтам
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setReview({
              targetType: "user",
              targetIds: targets.map((x) => x.id),
              requestKey: crypto.randomUUID(),
              action,
              reason: f.get("reason"),
              ...(f.get("hours")
                ? { durationHours: Number(f.get("hours")) }
                : {}),
              ...(action === "role" ? { role: f.get("role") } : {}),
            });
          }}
        >
          <Field label="Действие">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {labels[a]}
                </option>
              ))}
            </select>
          </Field>
          {["freeze", "restrict", "warn"].includes(action) && (
            <Field label="Срок в часах (пусто — до пересмотра)">
              <input
                name="hours"
                type="number"
                min="0.1"
                max="8760"
                step="0.1"
              />
            </Field>
          )}
          {action === "role" && (
            <Field label="Новая роль">
              <select name="role">
                {["USER", "MODERATOR", "SUPPORT", "ADMIN"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <small>
                Индивидуальные дополнительные полномочия сохраняются.
              </small>
            </Field>
          )}
          <Field label="Причина для всех выбранных аккаунтов">
            <textarea name="reason" required minLength={3} maxLength={2000} />
          </Field>
          <Button className="primary">Предпросмотр действия</Button>
        </form>
      )}
    </Modal>
  );
}
