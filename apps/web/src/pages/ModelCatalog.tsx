import { useState } from "react";
import { api } from "../services/api";
import { Button, Field, Modal, Tag, useLoad } from "../components/UI";
import {
  recommendations,
  recommendationDate,
  catalogFilter,
} from "../../../../packages/shared/model-recommendations";
export function ModelRecommendations({
  onConnection,
}: {
  onConnection?: (baseUrl: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        Рекомендации пользователей · 14.11.2026
      </Button>
      {open && (
        <Modal
          title="Модели · цены и пользовательский опыт"
          wide
          onClose={() => setOpen(false)}
        >
          <p>
            Актуальность обзора: {recommendationDate}. Официальные тарифы за 1
            млн токенов; отзывы отдельных пользователей, без заявления об общем
            мнении. Это кандидаты для проверки, а не результаты платного теста
            Orbit. Порог: вход ≤ $0,25 и отдельно выход ≤ $0,25.
          </p>
          {recommendations.map((r) => (
            <article className="recommendation" key={r.id}>
              <h3>
                {r.name}{" "}
                <Tag>{r.tier === "budget" ? "В бюджете" : "Дороже порога"}</Tag>
              </h3>
              <p>
                {r.provider} · вход ${r.input} · выход ${r.output} · контекст{" "}
                {r.context.toLocaleString()}
                {r.parametersB ? " · " + r.parametersB + "B" : ""}
              </p>
              {r.pros.map((p) => (
                <p key={p}>＋ {p}</p>
              ))}
              {r.cons.map((p) => (
                <p className="muted" key={p}>
                  − {p}
                </p>
              ))}
              <div className="button-row">
                <a href={r.priceSource} target="_blank" rel="noreferrer">
                  Официальный тариф
                </a>
                {r.reviewSources.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    Отзыв {i + 1}
                  </a>
                ))}
                {onConnection && (
                  <Button
                    onClick={() => {
                      onConnection(r.baseUrl, r.provider);
                      setOpen(false);
                    }}
                  >
                    Подготовить подключение {r.provider}
                  </Button>
                )}
              </div>
              <small>{r.reviewDisclaimer}</small>
            </article>
          ))}
        </Modal>
      )}
    </>
  );
}
export function CatalogFilters({
  models,
  provider,
  onSelect,
  selected,
}: {
  models: any[];
  provider: string;
  onSelect: (id: string, provider: string) => void;
  selected: string;
}) {
  const [q, setQ] = useState(""),
    [kind, setKind] = useState("direct"),
    [budget, setBudget] = useState(true),
    [small, setSmall] = useState(true),
    [unknown, setUnknown] = useState(false),
    [input, setInput] = useState(0.25),
    [output, setOutput] = useState(0.25),
    [count, setCount] = useState(50);
  const found = catalogFilter(models, {
    q,
    providerKind: kind,
    budget: String(budget),
    excludeSmall: String(small),
    includeUnknown: String(unknown),
    maxInput: input,
    maxOutput: output,
  });
  const price = (v: any) =>
    v === undefined ? "не подтверждена" : "$" + (Number(v) * 1e6).toFixed(3);
  return (
    <>
      <div className="form-grid">
        <Field label="Поиск по всем подключениям">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Название или ID модели"
          />
        </Field>
        <Field label="Провайдеры">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="direct">Прямые</option>
            <option value="router">Маршрутизаторы</option>
            <option value="local">Локальные</option>
            <option value="all">Все</option>
          </select>
        </Field>
        <Field label="Максимум за 1 млн входных токенов, $">
          <input
            type="number"
            min="0"
            step=".01"
            value={input}
            onChange={(e) => setInput(+e.target.value)}
          />
        </Field>
        <Field label="Максимум за 1 млн выходных токенов, $">
          <input
            type="number"
            min="0"
            step=".01"
            value={output}
            onChange={(e) => setOutput(+e.target.value)}
          />
        </Field>
      </div>
      <div className="button-row">
        <label className="check">
          <input
            type="checkbox"
            checked={budget}
            onChange={(e) => setBudget(e.target.checked)}
          />
          Оба ценовых предела
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={small}
            onChange={(e) => setSmall(e.target.checked)}
          />
          От 50B параметров
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={unknown}
            onChange={(e) => setUnknown(e.target.checked)}
          />
          Включая неизвестные данные
        </label>
      </div>
      <p className="muted">
        Найдено: {found.length}. Сначала дешевле. Псевдомодели автоматической
        маршрутизации исключены. Обновите каталог каждого нужного подключения.
      </p>
      <div className="model-picker">
        {found.slice(0, count).map((m) => (
          <button
            key={m.providerId + ":" + m.id}
            className={
              m.providerId === provider && m.id === selected ? "active" : ""
            }
            onClick={() => onSelect(m.id, m.providerId)}
          >
            <span>
              <b>{m.name || m.id}</b>
              <small>
                {m.providerName} · {m.id}
              </small>
              <small>
                Вход {price(m.pricing?.prompt)} / выход{" "}
                {price(m.pricing?.completion)} · контекст{" "}
                {m.context_length || "не указан"}
              </small>
              {m.priceEstimated && (
                <small>
                  Тариф из обзора {m.priceCheckedAt}; перепроверьте перед
                  запуском
                </small>
              )}
            </span>
          </button>
        ))}
      </div>
      {!found.length && (
        <p className="notice">
          В загруженных каталогах нет совпадений. Подключите прямого провайдера,
          обновите каталог или измените фильтры.
        </p>
      )}
      {count < found.length && (
        <Button onClick={() => setCount(count + 50)}>Показать ещё</Button>
      )}
    </>
  );
}
