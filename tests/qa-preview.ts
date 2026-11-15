// Local, disposable browser-QA fixture. Never opens the user's storage or a paid API.
import { mkdtempSync } from "node:fs";
import path from "node:path";
process.env.DATA_DIR = mkdtempSync(path.resolve("test-results-browser-"));
process.env.RUNTIME_CONFIG_FILE = path.join(
  process.env.DATA_DIR,
  "runtime.json",
);
process.env.NODE_ENV = "test";
const { buildApp } = await import("../apps/server/src/app.js");
const { run, id, now, setSetting } =
  await import("../apps/server/src/database/index.js");
const { createSpace } = await import("../apps/server/src/core.js");
const { sendMessage } = await import("../apps/server/src/messages/service.js");
const { ensureNotify } = await import("../apps/server/src/notify/service.js");
const { setVerification, freezeTarget } =
  await import("../apps/server/src/governance/service.js");
const { createTicket } = await import("../apps/server/src/notify/tickets.js");
const { generateAgent } =
  await import("../apps/server/src/ai/simulation/engine.js");
const { default: argon2 } = await import("argon2");
const app = await buildApp();
const response = await app.inject({
  method: "POST",
  url: "/api/auth/register",
  payload: {
    username: "preview_owner",
    displayName: "Александр",
    password: "Orbit-preview-2026!",
    language: "ru",
  },
});
if (response.statusCode !== 200) throw new Error(response.body);
const owner = response.json().user.id;
const human = id();
run(
  "INSERT INTO users(id,username,display_name,password_hash,type,role,bio,created_at,last_seen,presence_until) VALUES(?,?,?,?,'human','USER',?,?,?,?)",
  human,
  "preview_reader",
  "Мария",
  await argon2.hash("Orbit-preview-2026!"),
  "Фотография, книги и прогулки",
  now(),
  now(),
  now() + 3600000,
);
ensureNotify(human);
const ai = id();
await generateAgent({
  id: ai,
  payload: JSON.stringify({
    manualProfile: {
      displayName: "Никита",
      username: "nikita_art",
      bio: "Рисую город и собираю истории",
      birthDate: "1997-04-12",
      interests: ["архитектура", "рисование"],
    },
    behavior: {
      language: "ru",
      traits: { sociability: 0.8, energy: 0.9, initiative: 0.7 },
    },
  }),
});
const dm = createSpace(owner, {
  kind: "dm",
  title: "Разговор",
  members: [human],
});
sendMessage(human, dm, "Привет! Как тебе обновлённый Orbit?");
sendMessage(owner, dm, "Собираю идеи и проверяю новые возможности.");
const channel = createSpace(owner, {
  kind: "channel",
  title: "Городские истории",
  slug: "city_stories",
  description: "Места, люди и маленькие открытия. Совместный дневник города.",
});
sendMessage(
  owner,
  channel,
  "Иногда достаточно выйти на одну улицу дальше привычного маршрута.\n\nКакое место вы открыли для себя на этой неделе?",
);
run(
  "UPDATE spaces SET comments_mode='internal',show_author=1 WHERE id=?",
  channel,
);
setVerification(owner, channel, {
  action: "grant",
  categoryId: "company",
  reason: "Источник проверен в тестовой среде",
});
const group = createSpace(owner, {
  kind: "group",
  title: "Творческая мастерская",
  members: [human, ai],
});
sendMessage(
  human,
  group,
  "Давайте соберём небольшую коллекцию городских зарисовок.",
);
sendMessage(ai, group, "Начну с трамвайной остановки у старого парка.");
const frozen = createSpace(human, {
  kind: "channel",
  title: "Архив наблюдений",
  description: "Пример временно замороженного сообщества",
});
freezeTarget(owner, "space", frozen, {
  reasonCode: "spam",
  reason: "Демонстрационный случай: повторяющиеся публикации требуют проверки",
  durationHours: 24,
});
createTicket(human, {
  kind: "appeal",
  subject: "Проверить заморозку канала",
  body: "Прошу проверить решение по каналу. В тестовом примере объяснение и доказательства добавляются в Notify.",
  decisionId: (await import("../apps/server/src/database/index.js")).one(
    "SELECT id FROM moderation_decisions WHERE target_id=?",
    frozen,
  )!.id,
  requestKey: id(),
});
setSetting("simulation", {
  status: "stopped",
  mode: "test",
  target: 1,
  speed: 1,
  activity: 0.6,
});
const frozenUser = id();
run(
  "INSERT INTO users(id,username,display_name,password_hash,type,role,created_at,last_seen) VALUES(?,?,?,?,'human','USER',?,?)",
  frozenUser,
  "preview_frozen",
  "Замороженный профиль",
  await argon2.hash("Orbit-preview-2026!"),
  now(),
  now(),
);
ensureNotify(frozenUser);
freezeTarget(owner, "user", frozenUser, {
  reasonCode: "security",
  reason: "Тестовая заморозка для проверки изоляции Notify",
  durationHours: 24,
});
await app.listen({ host: "127.0.0.1", port: 4317 });
console.log(
  "Disposable QA preview http://127.0.0.1:4317 · preview_owner / preview_reader · password Orbit-preview-2026!",
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
