import { useState } from "react";
import { Search, Download, ExternalLink, Image, Upload } from "lucide-react";
import {
  useApp,
  useLoad,
  Button,
  Field,
  Tag,
  Modal,
  Loading,
} from "../components/UI";
import { api, post } from "../services/api";
export function MediaLibrary() {
  const { t, toast } = useApp();
  const { value, refresh } = useLoad<any[]>(() => api("/admin/media-library"));
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<any[] | null>(null),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<any>(null);
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Медиатека</h2>
          <p className="muted">
            Лицензияd Wikimedia assets, original generated avatars, and your
            local library.
          </p>
        </div>
        <Tag>СВЕДЕНИЯ О ЛИЦЕНЗИИ</Tag>
      </div>
      <section className="panel">
        <h2>Wikimedia Commons</h2>
        <p className="muted small-text">
          Найдите иллюстрации, животных или пейзажи. Перед импортом проверьте
          источник, лицензию и указание автора. Портреты людей не используются
          для автоматических аватаров.
        </p>
        <form
          className="explore-toolbar"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              setResults(
                await api(`/admin/media-search?q=${encodeURIComponent(query)}`),
              );
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="search-field">
            <Search size={17} />
            <input
              required
              value={query}
              placeholder="landscape, animal, drawing…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button className="primary" busy={busy}>
            {t("search")}
          </Button>
        </form>
        <div className="media-search-results">
          {results?.map((r, i) => (
            <article key={i}>
              <div className="media-placeholder">
                <Image size={30} />
                <small>{r.title}</small>
              </div>
              <Tag>{r.license}</Tag>
              <p>{r.attribution}</p>
              <a href={r.source} target="_blank" rel="noreferrer">
                Посмотреть изображение и лицензию <ExternalLink size={12} />
              </a>
              <Button onClick={() => setSelected(r)}>
                <Download size={14} />
                Импортировать
              </Button>
            </article>
          ))}
        </div>
        {results && !results.length && (
          <p className="muted">Подходящих изображений не найдено.</p>
        )}
      </section>
      <section className="panel">
        <h2>Local licensed assets</h2>
        <Field label="Upload image">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              try {
                const result = await api("/media", {
                  method: "POST",
                  body: form,
                });
                setSelected({
                  ...result,
                  local: true,
                  license: "CC0",
                  attribution: "",
                  title: file.name,
                });
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          />
        </Field>
        <div className="local-media-grid">
          {value?.map((m) => (
            <article key={m.id}>
              <img src={`/media/${m.id}`} alt={m.name} loading="lazy" />
              <b>{m.name}</b>
              <Tag>{m.license}</Tag>
              <p>{m.attribution}</p>
              <small>{m.tags}</small>
              {m.source?.startsWith("https:") && (
                <a href={m.source} target="_blank" rel="noreferrer">
                  Source / license
                </a>
              )}
            </article>
          ))}
        </div>
        <p className="muted small-text">
          If no matching asset is available, the system generates a unique
          original SVG avatar from the agent’s stable seed and interests. No
          third-party portrait is assigned automatically.
        </p>
      </section>
      {selected && (
        <Modal
          title="Импортировать licensed asset"
          onClose={() => setSelected(null)}
        >
          <p className="warning">
            Confirm you have reviewed the source and have permission to use this
            asset. Импортироватьed license and attribution remain attached to
            the local file.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              try {
                if (selected.local)
                  await post(`/admin/media-library/${selected.id}`, data);
                else
                  await post("/admin/media-import", { ...selected, ...data });
                setSelected(null);
                refresh();
                toast(t("save"));
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Лицензия">
              <select name="license" defaultValue={selected.license}>
                {(selected.local
                  ? ["CC0", "CC BY", "CC BY-SA"]
                  : [selected.license]
                ).map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Авторство">
              <textarea
                name="attribution"
                required
                defaultValue={selected.attribution}
              />
            </Field>
            <Field label="Теги интересов (фотография, природа, музыка…)">
              <input name="tags" required defaultValue={query} />
            </Field>
            <label className="check">
              <input type="checkbox" required />Я проверил(а) лицензию и права
              использования.
            </label>
            <Button busy={busy} className="primary full">
              Импортировать в локальную библиотеку
            </Button>
          </form>
        </Modal>
      )}
    </>
  );
}
