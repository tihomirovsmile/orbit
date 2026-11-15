// Explicit disposable UI fixture. Never called by start, migrate, or production code.
import path from "node:path";
if (
  !process.env.DATA_DIR ||
  path.basename(path.resolve(process.env.DATA_DIR)) !== "qa-preview"
)
  throw new Error("Set DATA_DIR to a separate qa-preview directory");
const { all, one, run, id, now, setSetting, sqlite } =
  await import("../apps/server/src/database/index.js");
if (one("SELECT id FROM users LIMIT 1"))
  throw new Error("QA fixture requires an empty database");
const { default: argon2 } = await import("argon2");
const { generateAgent } =
  await import("../apps/server/src/ai/simulation/engine.js");
const { createSpace } = await import("../apps/server/src/core.js");
const { sendMessage } = await import("../apps/server/src/messages/service.js");
const { createTopic } = await import("../apps/server/src/forum/index.js");
const ownerId = id();
run(
  "INSERT INTO users(id,username,display_name,password_hash,type,role,language,created_at,last_seen) VALUES(?,?,?,?,'human','OWNER','ru',?,?)",
  ownerId,
  "qa_owner",
  "QA Owner",
  await argon2.hash("Orbit-UI-test-only-2026"),
  now(),
  now(),
);
setSetting("setupClosed", true);
setSetting("network", {
  name: "Orbit · QA",
  description: "Disposable synthetic UI verification",
  language: "ru",
  registration: true,
  timezone: "Europe/Kyiv",
  access: "localhost",
});
setSetting("simulation", {
  status: "paused",
  mode: "test",
  speed: 10,
  target: 12,
  activity: 0.6,
  debug: true,
});
const agents: string[] = [];
for (let i = 0; i < 12; i++)
  agents.push(
    await generateAgent({
      id: id(),
      payload: JSON.stringify({ seed: "ui-fixture-" + i }),
    }),
  );
const titles = [
  "[TEST] Медленные утра",
  "[TEST] В мастерской",
  "[TEST] Музыка между делом",
  "[TEST] Технологии и жизнь",
];
for (let i = 0; i < 4; i++) {
  const sid = sqlite
    .transaction(() =>
      createSpace(agents[i], {
        kind: i % 2 ? "group" : "channel",
        title: titles[i],
        description: "[TEST] Synthetic UI fixture — no LLM requests.",
        members: [ownerId, ...agents.slice(5, 9)],
      }),
    )
    .immediate();
  sendMessage(
    agents[i],
    sid,
    "[TEST] Это синтетическое событие для проверки интерфейса. Оно сохранено в базе.",
  );
  if (i % 2)
    sendMessage(ownerId, sid, "[TEST] Проверяем ответы, реакции и историю.");
}
const direct = sqlite
  .transaction(() =>
    createSpace(ownerId, {
      kind: "dm",
      title: "QA conversation",
      members: [agents[0]],
    }),
  )
  .immediate();
sendMessage(
  agents[0],
  direct,
  "[TEST] привет! проверяем, как выглядит личная переписка",
);
sendMessage(
  ownerId,
  direct,
  "[TEST] Да, сообщение сохраняется после перезапуска.",
);
createTopic(
  ownerId,
  "support",
  "[TEST] Проверка форума",
  "[TEST] Тема для проверки ответов и модерации.",
);
sqlite.close();
console.log(
  "Disposable QA fixture created in qa-preview. Default storage is untouched.",
);
