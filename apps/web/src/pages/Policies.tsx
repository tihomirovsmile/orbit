import { useState } from "react";
import { api, put, post } from "../services/api";
import { Field, Button, Tag, useApp, useLoad } from "../components/UI";
export function Policies() {
  const { toast } = useApp(),
    data = useLoad<any>(() => api("/admin/policies"));
  const v = data.value;
  return !v ? null : (
    <details>
      <summary>Правила удаления, лимиты сообществ и файлов</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await put("/admin/policies", {
              governance: {
                channelDeleteSeconds: Number(f.get("deleteSeconds")),
                maxCommunitiesHuman: Number(f.get("human")),
                maxCommunitiesAi: Number(f.get("ai")),
              },
              documentMiB: Number(f.get("document")),
              attachments: Number(f.get("attachments")),
            });
            toast("Правила сохранены");
            data.refresh();
          } catch (e) {
            toast((e as Error).message);
          }
        }}
      >
        <div className="form-grid">
          {[
            [
              "deleteSeconds",
              "Отмена удаления сообщества, секунд",
              v.governance.channelDeleteSeconds,
              30,
              86400,
            ],
            [
              "human",
              "Сообществ на человека",
              v.governance.maxCommunitiesHuman,
              1,
              10000,
            ],
            ["ai", "Сообществ на ИИ", v.governance.maxCommunitiesAi, 1, 1000],
            [
              "document",
              "Размер документа, МиБ",
              v.media.documentFile / 1024 ** 2,
              1,
              800,
            ],
            ["attachments", "Вложений в сообщении", v.media.attachments, 1, 10],
          ].map(([name, label, value, min, max]: any) => (
            <Field label={label} key={name}>
              <input
                name={name}
                type="number"
                required
                min={min}
                max={max}
                defaultValue={value}
              />
            </Field>
          ))}
        </div>
        <p className="muted">{v.retention}</p>
        <Button>Сохранить правила</Button>
      </form>
    </details>
  );
}
export function ModelEvaluation({
  providerId,
  modelId,
}: {
  providerId: string;
  modelId: string;
}) {
  const { toast } = useApp(),
    history = useLoad<any[]>(() => api("/admin/model-evaluations")),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(null);
  return (
    <details>
      <summary>Проверка качества: восемь сценариев</summary>
      <p>
        Полнота профиля, русский язык, общение, приватность, память, характер,
        JSON и отказ от лишней активности. Выполняет до восьми платных запросов
        к выбранной модели. Рабочая модель сети не переключается. Смысл ответов
        оценивает человек; автоматическая проверка охватывает только структуру.
      </p>
      <p>Выбрано: {modelId || "модель не выбрана"}</p>
      <Button
        disabled={!providerId || !modelId}
        busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setResult(
              await post("/admin/model-evaluations", { providerId, modelId }),
            );
            history.refresh();
          } catch (e) {
            toast((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Запустить восемь оплачиваемых проверок
      </Button>
      {result && (
        <div>
          <Tag>
            {result.status === "complete"
              ? "Прогон завершён"
              : "Прогон остановлен"}
          </Tag>
          {result.results.map((r: any) => (
            <article className="recommendation" key={r.id}>
              <h4>{r.name}</h4>
              {r.error ? (
                <p className="error">{r.error}</p>
              ) : (
                <>
                  <p className="preserve-text">{r.output}</p>
                  <small>
                    {r.structural
                      ? "Структура прошла проверку"
                      : "Структура не прошла проверку"}
                    {r.needsHumanReview ? " · оцените содержание вручную" : ""}{" "}
                    · ${r.usage?.cost} · {r.durationMs} мс
                  </small>
                </>
              )}
            </article>
          ))}
        </div>
      )}
      <h4>История прогонов</h4>
      {history.value?.map((h) => (
        <Button key={h.id} onClick={() => setResult(h)}>
          {h.model_id} · {new Date(h.created_at).toLocaleString()} · {h.status}
        </Button>
      ))}
    </details>
  );
}
