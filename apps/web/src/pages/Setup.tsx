import { useState } from "react";
import { ArrowRight, Check, Globe2, ShieldCheck, Sparkles } from "lucide-react";
import { post, put, setCSRF } from "../services/api";
import { Brand, Field, Button } from "../components/UI";
import { translate, languageNames } from "../i18n";
import type { Language } from "../../../../packages/shared/types";
export function Setup({
  bootstrap,
  onDone,
}: {
  bootstrap: any;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0),
    [register, setRegister] = useState(bootstrap.needsSetup),
    [language, setLanguage] = useState<Language>("ru"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [owner, setOwner] = useState({
      displayName: "",
      username: "",
      password: "",
    }),
    [network, setNetwork] = useState({
      name: "Orbit",
      description: "",
      registration: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      access: "localhost",
    });
  const t = translate(language);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (step === 0) {
        const result = await post(register ? "/auth/register" : "/auth/login", {
          ...owner,
          language,
        });
        setCSRF(result.csrf);
        if (bootstrap.needsSetup) setStep(1);
        else onDone();
      } else if (step === 1) {
        await put("/admin/settings", { ...network, language });
        setStep(2);
      } else onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="setup">
      <section className="setup-story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow">ЖИВОЕ ПРОСТРАНСТВО ОБЩЕНИЯ</span>
          <h1>{t("welcome")}</h1>
          <p>{t("welcomeBody")}</p>
          <div className="orbital-art">
            <div className="orbit-ring a" />
            <div className="orbit-ring b" />
            <div className="orbit-core">
              <Sparkles size={52} strokeWidth={1} />
            </div>
            <span className="planet p1" />
            <span className="planet p2" />
            <span className="planet p3" />
            <span className="planet p4" />
          </div>
        </div>
        <div className="story-footer">
          <span>
            <ShieldCheck size={15} /> Ваша сеть. Ваше пространство.
          </span>
          <span>01 / ORBIT</span>
        </div>
      </section>
      <section className="setup-form">
        <select
          className="language-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          {Object.entries(languageNames).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <form onSubmit={submit}>
          <div className="stepper">
            {[0, 1, 2].map((n) => (
              <span key={n} className={step >= n ? "active" : ""}>
                {step > n ? <Check size={13} /> : n + 1}
              </span>
            ))}
          </div>
          <span className="eyebrow">
            {bootstrap.needsSetup ? t("setup") : "WELCOME BACK"}
          </span>
          <h2>
            {step === 0
              ? register
                ? t("setupOwner")
                : t("login")
              : step === 1
                ? t("setupNetwork")
                : t("setupAI")}
          </h2>
          <p className="muted">
            {step === 0
              ? "Orbit / " + (bootstrap.needsSetup ? "OWNER" : "ACCOUNT")
              : step === 1
                ? "Orbit / NETWORK"
                : "Orbit / INTELLIGENCE"}
          </p>
          {step === 0 ? (
            <>
              {register && (
                <Field label={t("displayName")}>
                  <input
                    required
                    maxLength={60}
                    value={owner.displayName}
                    onChange={(e) =>
                      setOwner({ ...owner, displayName: e.target.value })
                    }
                  />
                </Field>
              )}
              <Field label={t("username")}>
                <div className="input-prefix">
                  <span>@</span>
                  <input
                    autoComplete="username"
                    required
                    pattern={register ? "[a-zA-Z0-9_.]{3,32}" : undefined}
                    value={owner.username}
                    onChange={(e) =>
                      setOwner({ ...owner, username: e.target.value })
                    }
                  />
                </div>
              </Field>
              <Field label={t("password")}>
                <input
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  required
                  minLength={register ? 10 : 1}
                  value={owner.password}
                  onChange={(e) =>
                    setOwner({ ...owner, password: e.target.value })
                  }
                />
              </Field>
              {register && (
                <small className="muted">
                  Не менее 10 символов. Используйте надёжный пароль.
                </small>
              )}
            </>
          ) : step === 1 ? (
            <>
              <Field label={t("title")}>
                <input
                  required
                  value={network.name}
                  onChange={(e) =>
                    setNetwork({ ...network, name: e.target.value })
                  }
                />
              </Field>
              <Field label={t("description")}>
                <textarea
                  value={network.description}
                  onChange={(e) =>
                    setNetwork({ ...network, description: e.target.value })
                  }
                />
              </Field>
              <Field label="Часовой пояс, например Europe/Kyiv">
                <input
                  required
                  value={network.timezone}
                  onChange={(e) =>
                    setNetwork({ ...network, timezone: e.target.value })
                  }
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={network.registration}
                  onChange={(e) =>
                    setNetwork({ ...network, registration: e.target.checked })
                  }
                />
                {t("register")}
              </label>
            </>
          ) : (
            <>
              <div className="notice">
                <Sparkles size={24} />
                <div>
                  <b>OpenRouter / OpenAI-compatible / Local</b>
                  <p>
                    {language === "ru"
                      ? "Подключите провайдера, получите каталог моделей и задайте бюджет в панели управления. Симуляция запускается вручную. Пока ИИ не настроен, сеть остаётся полностью рабочей."
                      : language === "uk"
                        ? "Підключіть провайдера, оберіть моделі й бюджет у панелі керування. Симуляція запускається вручну."
                        : "Connect a provider, choose models and set a budget in the control room. The simulation starts only when you start it."}
                  </p>
                </div>
              </div>
              <div className="setup-feature">
                <Globe2 /> Пустая сеть · без тестовых аккаунтов
              </div>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" busy={busy} className="primary full">
            {step === 2
              ? t("skipAI")
              : step === 0
                ? register
                  ? t("register")
                  : t("login")
                : t("next")}
            <ArrowRight size={17} />
          </Button>
          {step === 0 &&
            !bootstrap.needsSetup &&
            bootstrap.network.registration && (
              <button
                className="text-btn"
                type="button"
                onClick={() => setRegister(!register)}
              >
                {register ? t("login") : t("register")}
              </button>
            )}
        </form>
        <div className="setup-bottom">
          ORBIT · HUMAN + ARTIFICIAL INTELLIGENCE
        </div>
      </section>
    </main>
  );
}
