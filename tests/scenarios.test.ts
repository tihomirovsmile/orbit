import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { io as connectSocket } from "socket.io-client";
process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(path.resolve("test-results-"));
process.env.RUNTIME_CONFIG_FILE = path.join(
  process.env.DATA_DIR,
  "runtime.json",
);
const { buildApp } = await import("../apps/server/src/app.js");
const db = await import("../apps/server/src/database/index.js");
const { all, one, run, setting, setSetting, id, now, sqlite } = db;
const engine = await import("../apps/server/src/ai/simulation/engine.js");
const { sendMessage, rememberInteraction } =
  await import("../apps/server/src/messages/service.js");
const { capture } = await import("../apps/server/src/ai/memory/index.js");
const { reserve, finishUsage, limits } =
  await import("../apps/server/src/billing/index.js");
const { encrypt, decrypt, validateEndpoint, privateIP } =
  await import("../apps/server/src/ai/providers/security.js");
const { complete } = await import("../apps/server/src/ai/providers/service.js");
const { behavioralProfile, syntheticPersona, tooSimilar } =
  await import("../apps/server/src/ai/personality/index.js");
const app = await buildApp();
await app.listen({ host: "127.0.0.1", port: 0 });
type Client = { cookie: string; csrf: string; user: any };
async function request(
  method: string,
  url: string,
  body?: any,
  client?: Client,
) {
  return app.inject({
    method: method as any,
    url: "/api" + url,
    payload: body,
    headers: client
      ? { cookie: client.cookie, "x-csrf-token": client.csrf }
      : {},
  });
}
async function ok(method: string, url: string, body?: any, client?: Client) {
  const r = await request(method, url, body, client);
  assert.ok(r.statusCode < 300, `${method} ${url}: ${r.statusCode} ${r.body}`);
  return r.json();
}
async function register(username: string): Promise<Client> {
  const r = await request("POST", "/auth/register", {
    username,
    displayName: username,
    password: "Strong-test-password!",
    language: "ru",
  });
  assert.equal(r.statusCode, 200, r.body);
  return {
    cookie: r.headers["set-cookie"]!.toString().split(";")[0],
    csrf: r.json().csrf,
    user: r.json().user,
  };
}
let completions = 0,
  failProvider = false;
let transportMode = "normal";
const prompts: any[] = [];
const mock = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models")
    return res.end(
      JSON.stringify({
        data: [
          {
            id: "test/fixture",
            name: "Explicit test fixture model",
            description: "Mock transport for automated tests only",
            context_length: 64000,
            pricing: { prompt: "0.000001", completion: "0.000002" },
            supported_parameters: ["response_format"],
          },
        ],
      }),
    );
  if (req.url === "/v1/chat/completions") {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    prompts.push(body);
    completions++;
    if (transportMode === "rate"||transportMode==='rate-long') {
      res.statusCode = 429;
      res.setHeader("Retry-After", transportMode==='rate-long'?'7200':'2');
      return res.end(JSON.stringify({ error: { message: "Test quota" } }));
    }
    if (transportMode === "reasoning")
      return res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '<think>private scratchpad</think>```json\n{"text":"Final only"}\n```',
                reasoning: "must never be read",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 9, cost: 0.00002 },
        }),
      );
    if (transportMode === "empty")
      return res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: null, reasoning: "private scratchpad" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 9, cost: 0.00002 },
        }),
      );
    if (transportMode === "length")
      return res.end(
        JSON.stringify({
          choices: [
            { message: { content: '{"unfinished":' }, finish_reason: "length" },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 9, cost: 0.00002 },
        }),
      );
    if (
      transportMode === "self-profile" ||
      transportMode === "accept-transfer"
    ) {
      const input = JSON.parse(body.messages[1].content),
        answer =
          transportMode === "self-profile"
            ? {
                change: true,
                reason: "Actual reading prompted a modest preference change",
                displayName: "Updated personality",
                bio: "More interested in city sketches",
                interests: ["drawing", "architecture"],
                traits: { openness: 1 },
              }
            : { action: "accept_transfer", id: input.transfers[0]?.id };
      return res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(answer) } }],
          usage: { prompt_tokens: 20, completion_tokens: 20, cost: 0.0001 },
        }),
      );
    }
    if (transportMode === "minimal" || transportMode === "invalid-profile")
      return res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  transportMode === "minimal"
                    ? JSON.stringify({
                        displayName: "Model draft",
                        username: "model_draft",
                      })
                    : JSON.stringify({ bio: "Only an optional field" }),
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.0001 },
        }),
      );
    if (failProvider) {
      res.statusCode = 503;
      return res.end("{}");
    }
    let content;
    const system = body.messages[0].content;
    if (system.startsWith("Create a fictional")) {
      const input = JSON.parse(body.messages[1].content);
      content = JSON.stringify({
        ...syntheticPersona(input.seed),
        bio: "Explicit fixture profile",
      });
    } else if (system.startsWith("Handle your Notify inbox"))
      content = JSON.stringify({ action: "none" });
    else if (system.startsWith("Compress the supplied"))
      content = JSON.stringify({
        summary: JSON.parse(body.messages[1].content).summary,
      });
    else if (system.startsWith("Choose one ordinary"))
      content = JSON.stringify({ action: "idle" });
    else if (system.startsWith("Review the reported"))
      content = JSON.stringify({
        recommendation: "review",
        rationale:
          "Explicit mock advice for the reported content. No automatic punishment.",
      });
    else {
      const language = system.match(/Write in (ru|uk|en|it|es)/)?.[1] || "en";
      const samples: Record<string, string> = {
        ru: "Я читаю обсуждение рисунка",
        uk: "Я читаю обговорення малюнка",
        en: "I am reading the drawing discussion",
        it: "Sto leggendo la discussione sul disegno",
        es: "Estoy leyendo la conversación sobre el dibujo",
      };
      content = JSON.stringify({
        text: `[MOCK] ${samples[language]} · fixture ${completions} ${id()}.`,
      });
    }
    return res.end(
      JSON.stringify({
        id: "mock-completion-" + completions,
        choices: [{ message: { role: "assistant", content } }],
        usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0.00018 },
      }),
    );
  }
  res.statusCode = 404;
  res.end("{}");
});
await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
const mockAddress = mock.address() as any;
await test("Full persisted social network scenarios A–G", async (t) => {
  let owner: Client,
    other: Client,
    third: Client,
    providerId: string,
    groupId: string,
    dmId: string,
    channelId: string,
    agents: string[] = [];
  try {
    await t.test(
      "Version 1 migration preserves accounts, messages and encrypted keys; repeat is safe",
      async () => {
        const old = new Database(":memory:");
        try {
          old.exec(
            readFileSync("apps/server/src/database/001_initial.sql", "utf8"),
          );
          old.exec(
            "INSERT INTO users(id,username,display_name,type,role,created_at,last_seen) VALUES('owner','migration_owner','Kept owner','human','OWNER',1,1)",
          );
          old.exec(
            "INSERT INTO spaces(id,kind,title,slug,owner_id,invite,created_at) VALUES('channel','channel','Kept channel','kept','owner','invite',1)",
          );
          old.exec(
            "INSERT INTO space_members(space_id,user_id,role,joined_at) VALUES('channel','owner','admin',1)",
          );
          old.exec(
            "INSERT INTO messages(id,space_id,sender_id,text,created_at) VALUES('message','channel','owner','Kept post',1)",
          );
          old.exec(
            "INSERT INTO providers VALUES('p','Kept','compatible','https://example.com/v1','encrypted-fixture',NULL,30000,1,1,0,1,1)",
          );
          const { upgradeDatabase } =
            await import("../apps/server/src/database/upgrade.js");
          upgradeDatabase(old);
          upgradeDatabase(old);
          assert.equal(
            (old.prepare("SELECT display_name FROM users").get() as any)
              .display_name,
            "Kept owner",
          );
          assert.equal(
            (old.prepare("SELECT text FROM messages").get() as any).text,
            "Kept post",
          );
          assert.equal(
            (
              old
                .prepare("SELECT secret,cooldown_until FROM providers")
                .get() as any
            ).secret,
            "encrypted-fixture",
          );
          assert.equal(
            (old.prepare("SELECT comments_enabled FROM spaces").get() as any)
              .comments_enabled,
            0,
          );
          assert.equal(old.pragma("user_version", { simple: true }), 3);
          assert.equal(old.pragma("integrity_check", { simple: true }), "ok");
        } finally {
          old.close();
        }
      },
    );
    await t.test(
      "A: empty installation, concurrent registration, atomic single OWNER, authenticated admin",
      async () => {
        const initial = await ok("GET", "/bootstrap");
        assert.equal(initial.needsSetup, true);
        assert.equal(one("SELECT count(*) n FROM users")!.n, 0);
        const clients = await Promise.all([
          register("first_owner"),
          register("second_user"),
        ]);
        owner = clients.find((c) => c.user.role === "OWNER")!;
        other = clients.find((c) => c.user.role === "USER")!;
        assert.equal(
          one("SELECT count(*) n FROM users WHERE role='OWNER'")!.n,
          1,
        );
        assert.equal((await ok("GET", "/bootstrap")).needsSetup, false);
        assert.equal(
          (await request("GET", "/admin/overview", undefined, other))
            .statusCode,
          403,
        );
        assert.equal((await request("GET", "/admin/overview")).statusCode, 401);
        await ok("GET", "/admin/overview", undefined, owner);
        third = await register("third_user");
        const unsafe = await app.inject({
          method: "PUT",
          url: "/api/admin/limits",
          headers: { cookie: owner.cookie },
          payload: {},
        });
        assert.equal(unsafe.statusCode, 403);
        await ok(
          "PUT",
          "/admin/settings",
          {
            name: "Test Orbit",
            description: "QA network",
            language: "ru",
            registration: true,
            maxHumans: 10,
            timezone: "Europe/Kyiv",
            access: "localhost",
          },
          owner,
        );
      },
    );
    await t.test(
      "B: encrypted provider, actual HTTP model catalog, assignments, 10 unique profiles",
      async () => {
        assert.equal(await decrypt(encrypt("secret-value")), "secret-value");
        await assert.rejects(
          validateEndpoint("http://127.0.0.1:1234/v1", false),
        );
        assert.equal(privateIP("169.254.169.254"), true);
        const p = await ok(
          "POST",
          "/admin/providers",
          {
            name: "Test-only mock server",
            type: "local",
            baseUrl: `http://127.0.0.1:${mockAddress.port}/v1`,
            apiKey: "mock-secret-do-not-leak",
            trustedLocal: true,
          },
          owner,
        );
        providerId = p.id;
        const publicProviders = await ok(
          "GET",
          "/admin/providers",
          undefined,
          owner,
        );
        assert.ok(!JSON.stringify(publicProviders).includes("mock-secret"));
        assert.notEqual(
          one("SELECT secret FROM providers WHERE id=?", providerId)!.secret,
          "mock-secret-do-not-leak",
        );
        const catalog = await ok(
          "POST",
          `/admin/providers/${providerId}/models`,
          {},
          owner,
        );
        assert.equal(catalog[0].id, "test/fixture");
        await ok(
          "POST",
          "/admin/models/assign",
          { task: "message", providerId, modelId: "test/fixture" },
          owner,
        );
        await ok(
          "POST",
          "/admin/models/assign",
          { task: "personality", providerId, modelId: "test/fixture" },
          owner,
        );
        setSetting("limits", {
          ...limits(),
          rpm: 200,
          maxActive: 3,
          daily: 20,
          monthly: 100,
        });
        await ok(
          "POST",
          "/admin/simulation",
          { action: "start", mode: "live", target: 10, activity: 0 },
          owner,
        );
        for (let i = 0; i < 10; i++) {
          const job = {
            id: id(),
            payload: JSON.stringify({ seed: "fixture-agent-" + i }),
          };
          agents.push(await engine.generateAgent(job));
        }
        assert.equal(
          new Set(
            all("SELECT username FROM users WHERE type='ai'").map(
              (u) => u.username,
            ),
          ).size,
          10,
        );
        assert.equal(one("SELECT count(*) n FROM ai_personas")!.n, 10);
        assert.ok(
          all("SELECT avatar FROM users WHERE type='ai'").every(
            (u) => u.avatar,
          ),
        );
        run("UPDATE ai_personas SET next_action_at=?", now() + 86400000);
      },
    );
    await t.test(
      "Owner can configure the next startup port/interface/storage without rebinding the live server",
      async () => {
        const active = await ok("GET", "/admin/runtime", undefined, owner);
        assert.equal(
          (
            await request(
              "PUT",
              "/admin/runtime",
              { host: "0.0.0.0", port: 3200, dataDir: process.env.DATA_DIR },
              other,
            )
          ).statusCode,
          403,
        );
        const result = await ok(
          "PUT",
          "/admin/runtime",
          {
            host: "127.0.0.1",
            port: 3200,
            dataDir: process.env.DATA_DIR,
            publicOrigin: "",
            secureCookie: false,
          },
          owner,
        );
        assert.equal(result.restartRequired, true);
        const after = await ok("GET", "/admin/runtime", undefined, owner);
        assert.equal(after.active.port, active.active.port);
        assert.equal(after.pending.port, 3200);
      },
    );
    await t.test(
      "Social functions: groups, reactions, editing, forwarding, read receipts, private access and human chat",
      async () => {
        const g = await ok(
          "POST",
          "/spaces",
          {
            kind: "group",
            title: "Painting studio",
            description: "Drawing and art",
            visibility: "public",
            members: agents.slice(0, 2),
          },
          owner,
        );
        groupId = g.id;
        await ok("POST", `/spaces/${groupId}/join`, {}, other);
        const m = await ok(
          "POST",
          `/spaces/${groupId}/messages`,
          { text: "Welcome to the painting discussion" },
          owner,
        );
        await ok("POST", `/messages/${m.id}/reactions`, { emoji: "❤" }, other);
        await ok(
          "PATCH",
          `/messages/${m.id}`,
          { text: "Welcome to the painting discussion!" },
          owner,
        );
        await ok("POST", `/spaces/${groupId}/read`, {}, other);
        const messages = await ok(
          "GET",
          `/spaces/${groupId}/messages`,
          undefined,
          owner,
        );
        assert.equal(messages[0].reactions[0].count, 1);
        assert.equal(messages[0].readCount, 1);
        assert.ok(messages[0].editedAt);
        assert.equal(
          (
            await request(
              "PATCH",
              `/messages/${m.id}`,
              { text: "unauthorized" },
              other,
            )
          ).statusCode,
          403,
        );
        const d = await ok(
          "POST",
          "/spaces",
          {
            kind: "dm",
            title: "Private conversation",
            members: [other.user.id],
          },
          owner,
        );
        dmId = d.id;
        await ok(
          "POST",
          `/spaces/${dmId}/messages`,
          { text: "private content" },
          owner,
        );
        assert.equal(
          (await request("GET", `/spaces/${dmId}/messages`, undefined, third))
            .statusCode,
          403,
        );
        const f = await ok(
          "POST",
          `/spaces/${dmId}/messages`,
          { forwardedFrom: m.id },
          owner,
        );
        assert.ok(f.id);
        await ok("POST", `/spaces/${dmId}/read`, {}, other);
        await ok("POST", `/users/${other.user.id}/block`, {}, owner);
        assert.equal(
          (
            await request(
              "POST",
              `/spaces/${dmId}/messages`,
              { text: "blocked" },
              other,
            )
          ).statusCode,
          403,
        );
        await ok("POST", `/users/${other.user.id}/block`, {}, owner);
      },
    );
    await t.test(
      "C: agents meet in a group, talk privately, retain separate factual memories",
      async () => {
        const firstMessage = sendMessage(
          agents[0],
          groupId,
          "I started a small painting yesterday.",
        );
        capture(agents[1], groupId);
        const relationship = one(
          "SELECT * FROM relationships WHERE user_id=? AND target_id=?",
          agents[1],
          agents[0],
        );
        assert.equal(relationship.kind, "acquaintance");
        assert.ok(relationship.strength < 0.1);
        const { createSpace } = await import("../apps/server/src/core.js");
        const d = txCreate(() =>
          createSpace(agents[0], {
            kind: "dm",
            title: "Art chat",
            members: [agents[1]],
          }),
        );
        run("UPDATE ai_jobs SET status='complete'");
        const source = sendMessage(
          agents[0],
          d,
          "Did you see the painting I mentioned in the studio?",
        );
        engine.enqueue(agents[1], "reply", {
          spaceId: d,
          sourceId: source,
          replyIntent: true,
          depth: 0,
        });
        run(
          "UPDATE ai_jobs SET run_at=? WHERE agent_id=? AND kind='reply'",
          now() - 1,
          agents[1],
        );
        await engine.tick();
        assert.ok(
          one(
            "SELECT 1 FROM message_reads WHERE message_id=? AND user_id=?",
            source,
            agents[1],
          ),
        );
        const pending = one(
          "SELECT * FROM ai_deliveries WHERE space_id=? AND agent_id=? AND status='pending'",
          d,
          agents[1],
        );
        if (pending) {
          run("UPDATE ai_deliveries SET due_at=0 WHERE id=?", pending.id);
          const { deliverPending } =
            await import("../apps/server/src/ai/simulation/delivery.js");
          deliverPending(true);
          assert.ok(one("SELECT id FROM messages WHERE job_id=?", pending.id));
        }
        assert.ok(
          one(
            "SELECT id FROM agent_memories WHERE user_id=? AND target_id=?",
            agents[1],
            agents[0],
          ),
        );
        assert.equal(
          one(
            "SELECT count(*) n FROM agent_memories WHERE user_id=?",
            agents[2],
          )!.n,
          0,
        );
      },
    );
    await t.test(
      "D: channel identity, publishing permission, disabled comments and views",
      async () => {
        const { createSpace } = await import("../apps/server/src/core.js");
        channelId = txCreate(() =>
          createSpace(agents[0], {
            kind: "channel",
            title: "Drawings in progress",
            description: "Sketchbook",
          }),
        );
        const postId = sendMessage(
          agents[0],
          channelId,
          "A new page in my sketchbook.",
        );
        assert.throws(() => sendMessage(agents[1], channelId, "Not a member"));
        run(
          "INSERT INTO space_members(space_id,user_id,joined_at) VALUES(?,?,?)",
          channelId,
          agents[1],
          now(),
        );
        assert.throws(() => sendMessage(agents[1], channelId, "Not an admin"));
        await ok("POST", `/spaces/${channelId}/join`, {}, other);
        const rejectedComment = await request(
          "POST",
          `/messages/${postId}/comments`,
          { body: "I like the composition." },
          other,
        );
        assert.equal(rejectedComment.statusCode, 409);
        const comments = await request(
          "GET",
          `/messages/${postId}/comments`,
          undefined,
          owner,
        );
        assert.equal(comments.statusCode, 409);
        const posts = await ok(
          "GET",
          `/spaces/${channelId}/messages`,
          undefined,
          other,
        );
        assert.equal(posts[0].displayName, "Drawings in progress");
        assert.equal(posts[0].senderId, channelId);
        assert.equal(posts[0].type, "channel");
        const publicProfile = await ok(
          "GET",
          `/spaces/${channelId}/profile`,
          undefined,
          other,
        );
        assert.equal(publicProfile.ownerId, undefined);
        assert.equal(publicProfile.owner_id, undefined);
        assert.equal(publicProfile.admins, undefined);
        assert.equal(publicProfile.participants, undefined);
        assert.equal(
          (
            await request(
              "GET",
              `/spaces/${channelId}/members`,
              undefined,
              other,
            )
          ).statusCode,
          403,
        );
        await ok("POST", `/spaces/${channelId}/read`, {}, other);
        await ok("POST", `/spaces/${channelId}/read`, {}, other);
        assert.equal(
          one(
            "SELECT count(*) n FROM message_reads WHERE message_id=?",
            postId,
          )!.n,
          1,
        );
      },
    );
    await t.test(
      "E: actual ban, appeal-only access, moderator reply and reversal",
      async () => {
        await ok(
          "POST",
          `/admin/users/${agents[1]}/action`,
          { action: "ban", reason: "Test moderation reason linked to audit" },
          owner,
        );
        assert.throws(() => sendMessage(agents[1], groupId, "cannot send"));
        const { sessionFor } = await import("../apps/server/src/auth/index.js");
        const session = sessionFor(agents[1]);
        const banned = {
          cookie: "session=" + session.token,
          csrf: session.csrf,
          user: { id: agents[1] },
        };
        assert.deepEqual(
          (await ok("GET", "/spaces", undefined, banned)).map((x: any) => x.id),
          ["notify"],
        );
        assert.equal(
          (await request("GET", "/forum", undefined, banned)).statusCode,
          403,
        );
        const decision = one(
          "SELECT * FROM moderation_decisions WHERE target_type='user' AND target_id=? AND active=1",
          agents[1],
        );
        const ticket = await ok(
          "POST",
          "/notify/tickets",
          {
            kind: "appeal",
            decisionId: decision.id,
            subject: "Please review my ban",
            body: "I would like the actual decision reviewed.",
            requestKey: id(),
          },
          banned,
        );
        await ok(
          "POST",
          "/admin/support/" + ticket.id + "/messages",
          { body: "We reviewed this actual decision.", requestKey: id() },
          owner,
        );
        await ok(
          "PATCH",
          "/admin/support/" + ticket.id,
          { action: "accepted", reason: "Decision reversed after review" },
          owner,
        );
        assert.equal(
          one("SELECT status FROM users WHERE id=?", agents[1])!.status,
          "active",
        );
        assert.equal(
          (
            await request(
              "POST",
              `/admin/users/${owner.user.id}/action`,
              { action: "ban", reason: "must fail" },
              owner,
            )
          ).statusCode,
          403,
        );
      },
    );
    await t.test(
      "Socket regression: repeated reads do not form a broadcast feedback loop, typing excludes its sender",
      async () => {
        const address = app.server.address() as any;
        const socket = connectSocket(`http://127.0.0.1:${address.port}`, {
          transports: ["websocket"],
          extraHeaders: { Cookie: owner.cookie },
        });
        try {
          await new Promise<void>((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("connect_error", reject);
          });
          let readEvents = 0,
            typingEvents = 0;
          socket.on("read", () => readEvents++);
          socket.on("typing", () => typingEvents++);
          socket.emit("join-space", dmId);
          sendMessage(
            other.user.id,
            dmId,
            "A fresh unread message for realtime regression.",
          );
          await ok("POST", `/spaces/${dmId}/read`, {}, owner);
          await new Promise((resolve) => setTimeout(resolve, 40));
          const baseline = readEvents;
          assert.equal(baseline, 1);
          await ok("POST", `/spaces/${dmId}/read`, {}, owner);
          await new Promise((resolve) => setTimeout(resolve, 40));
          assert.equal(readEvents, baseline);
          socket.emit("typing", { spaceId: dmId });
          socket.emit("typing", null);
          await new Promise((resolve) => setTimeout(resolve, 40));
          assert.equal(typingEvents, 0);
        } finally {
          socket.disconnect();
        }
      },
    );
    await t.test(
      "Validated autonomous channel creation, publication, subscription, comment, avatar history and fan labels",
      async () => {
        run("UPDATE ai_jobs SET status='complete'");
        const first = await ok(
          "POST",
          `/admin/agents/${agents[5]}/action`,
          { kind: "create_channel" },
          owner,
        );
        await engine.tick();
        assert.equal(
          one("SELECT status FROM ai_jobs WHERE id=?", first.id)!.status,
          "complete",
        );
        const channel = one(
          "SELECT id FROM spaces WHERE owner_id=? AND kind='channel'",
          agents[5],
        );
        assert.ok(channel);
        const publish = await ok(
          "POST",
          `/admin/agents/${agents[5]}/action`,
          { kind: "post", spaceId: channel.id },
          owner,
        );
        await engine.tick();
        assert.ok(one("SELECT id FROM messages WHERE job_id=?", publish.id));
        await ok(
          "POST",
          `/admin/agents/${agents[6]}/action`,
          { kind: "subscribe", spaceId: channel.id },
          owner,
        );
        await engine.tick();
        assert.ok(
          one(
            "SELECT 1 FROM space_members WHERE space_id=? AND user_id=?",
            channel.id,
            agents[6],
          ),
        );
        const comment = await ok(
          "POST",
          `/admin/agents/${agents[6]}/action`,
          { kind: "comment", spaceId: channel.id },
          owner,
        );
        await engine.tick();
        assert.equal(
          one("SELECT status FROM ai_jobs WHERE id=?", comment.id)!.status,
          "complete",
        );
        assert.equal(
          one("SELECT id FROM forum_replies WHERE id=?", comment.id),
          undefined,
        );
        const originalSeed = one(
          "SELECT seed FROM ai_personas WHERE user_id=?",
          agents[5],
        )!.seed;
        await ok(
          "POST",
          `/admin/agents/${agents[5]}/action`,
          { kind: "avatar" },
          owner,
        );
        await engine.tick();
        assert.equal(
          one("SELECT seed FROM ai_personas WHERE user_id=?", agents[5])!.seed,
          originalSeed,
        );
        assert.equal(
          one(
            "SELECT count(*) n FROM avatar_history WHERE user_id=?",
            agents[5],
          )!.n,
          2,
        );
        const jobs = await ok(
          "POST",
          "/admin/agents/create",
          {
            count: 1,
            publicFigure: {
              name: "Example Public Artist",
              facts: "Publicly known for painting fictional landscapes.",
              source: "https://example.com/public-biography",
            },
          },
          owner,
        );
        await engine.tick();
        const fan = one("SELECT * FROM users WHERE id=?", jobs.jobs[0]);
        assert.equal(fan.display_name, "Example Public Artist");
        assert.equal(fan.type, "ai");
        assert.equal(fan.verified, 0);
        assert.ok(
          one("SELECT public_figure FROM ai_personas WHERE user_id=?", fan.id)!
            .public_figure,
        );
        assert.equal(
          (
            await request(
              "POST",
              `/admin/users/${fan.id}/action`,
              { action: "verify", reason: "Must not verify an AI" },
              owner,
            )
          ).statusCode,
          410,
        );
      },
    );
    await t.test(
      "Independent memory, planning and advisory moderation model tasks, no privilege escalation",
      async () => {
        run("UPDATE ai_jobs SET status='complete'");
        for (const task of ["memory", "planning", "moderation"])
          await ok(
            "POST",
            "/admin/models/assign",
            { task, providerId, modelId: "test/fixture" },
            owner,
          );
        run(
          "UPDATE ai_personas SET summary=? WHERE user_id=?",
          "The painting was discussed in the studio.",
          agents[7],
        );
        const memoryJob = engine.enqueue(agents[7], "memory"),
          planningJob = engine.enqueue(agents[8], "planning");
        await engine.tick();
        assert.equal(
          one("SELECT status FROM ai_jobs WHERE id=?", memoryJob)!.status,
          "complete",
        );
        assert.equal(
          one("SELECT status FROM ai_jobs WHERE id=?", planningJob)!.status,
          "complete",
        );
        assert.match(
          one("SELECT summary FROM ai_personas WHERE user_id=?", agents[7])!
            .summary,
          /painting/,
        );
        const publicMessage = one(
          "SELECT id FROM messages WHERE space_id=?",
          groupId,
        );
        await ok(
          "POST",
          "/reports",
          {
            targetId: publicMessage.id,
            reason: "Please review the actual message, no invented violation.",
          },
          other,
        );
        const report = one(
          "SELECT id FROM reports ORDER BY created_at DESC LIMIT 1",
        );
        const review = await ok(
          "POST",
          `/admin/reports/${report.id}/review`,
          {},
          owner,
        );
        assert.equal(review.recommendation, "review");
        assert.equal(
          one("SELECT status FROM reports WHERE id=?", report.id)!.status,
          "open",
        );
        const privateMessage = one(
          "SELECT id FROM messages WHERE space_id=?",
          dmId,
        );
        assert.equal(
          (
            await request(
              "POST",
              "/reports",
              {
                targetId: privateMessage.id,
                reason: "Unauthorized private report",
              },
              third,
            )
          ).statusCode,
          403,
        );
        const results = await ok(
          "GET",
          "/admin/public-messages?q=private%20content",
          undefined,
          owner,
        );
        assert.equal(results.length, 0);
        assert.equal(
          one("SELECT role FROM users WHERE id=?", agents[8])!.role,
          "USER",
        );
      },
    );
    await t.test(
      "F: concurrent budget reservations prevent new paid calls; API failures preserve social functions and queue",
      async () => {
        run("UPDATE ai_jobs SET status='complete'");
        const prior = limits();
        setSetting("limits", { ...prior, daily: 0, monthly: 0 });
        const before = completions;
        await assert.rejects(
          complete("message", [{ role: "user", content: "budget test" }]),
        );
        assert.equal(completions, before);
        const source = sendMessage(
          owner.user.id,
          groupId,
          "A new message survives the budget cap",
        );
        const jobId = engine.enqueue(agents[0], "reply", {
          spaceId: groupId,
          sourceId: source,
          replyIntent: true,
          depth: 0,
        });
        await engine.tick();
        assert.equal(
          one("SELECT status FROM ai_jobs WHERE id=?", jobId)!.status,
          "queued",
        );
        assert.ok(one("SELECT id FROM messages WHERE id=?", source));
        setSetting("limits", prior);
        failProvider = true;
        await assert.rejects(
          complete("message", [{ role: "user", content: "provider failure" }]),
        );
        assert.ok(one("SELECT id FROM token_usage WHERE status='error'"));
        const outageJob = engine.enqueue(agents[0], "reply", {
          spaceId: groupId,
          sourceId: source,
          replyIntent: true,
          depth: 0,
        });
        await engine.tick();
        assert.equal(setting("simulation", {} as any).status, "running");
        assert.equal(
          one("SELECT status FROM ai_jobs WHERE id=?", outageJob)!.status,
          "queued",
        );
        failProvider = false;
        run(
          "UPDATE providers SET cooldown_until=0,last_error=NULL WHERE id=?",
          providerId,
        );
        await ok("POST", "/admin/simulation", { action: "resume" }, owner);
        await ok(
          "POST",
          `/spaces/${dmId}/messages`,
          { text: "Humans can still chat" },
          other,
        );
        const cap = one("SELECT coalesce(sum(cost),0) n FROM token_usage")!.n;
        setSetting("limits", { ...prior, daily: cap + 0.11, monthly: 100 });
        const r1 = reserve(providerId, "test/fixture", null, "test", 0.1, 100);
        assert.throws(() =>
          reserve(providerId, "test/fixture", null, "test", 0.1, 100),
        );
        finishUsage(r1, 1, 1, 0);
        setSetting("limits", prior);
      },
    );
    await t.test(
      "Thinking models: final content only, robust JSON, no partial profiles",
      async () => {
        const { parseStructured, visibleText } =
          await import("../apps/server/src/ai/providers/output.js");
        try {
          transportMode = "reasoning";
          const response = await complete("message", [
            { role: "user", content: "Return JSON" },
          ]);
          assert.deepEqual(parseStructured(response.text), {
            text: "Final only",
          });
          assert.ok(!response.text.includes("scratchpad"));
          assert.equal(visibleText({ reasoning: "thoughts" }), "");
          assert.deepEqual(
            parseStructured(
              'Here is JSON: {"text":"braces } and \\\" quotes"} trailing',
            ),
            { text: 'braces } and " quotes' },
          );
          transportMode = "empty";
          await assert.rejects(
            complete("message", [{ role: "user", content: "test" }]),
            (e: any) => e.code === "AI_EMPTY_FINAL",
          );
          transportMode = "length";
          await assert.rejects(
            complete("message", [{ role: "user", content: "test" }]),
            (e: any) => e.code === "AI_OUTPUT_LIMIT",
          );
        } finally {
          transportMode = "normal";
        }
      },
    );
    await t.test(
      "Mixed persona draft preserves locked fields, optional omissions are safe and repair is bounded",
      async () => {
        const { generatePersonaDraft } =
          await import("../apps/server/src/ai/personality/drafts.js");
        try {
          transportMode = "minimal";
          const count = completions,
            result = await generatePersonaDraft({
              seed: "mixed",
              locked: {
                displayName: "Explicit name",
                username: "explicit_handle",
                country: "Украина",
                birthDate: "1994-02-10",
              },
            });
          assert.equal(completions - count, 1);
          assert.equal(result.profile.displayName, "Explicit name");
          assert.equal(result.profile.username, "explicit_handle");
          assert.equal(result.profile.country, "Украина");
          assert.equal(result.profile.birthDate, "1994-02-10");
          assert.equal(result.profile.bio, "");
          assert.ok(result.profile.interests.length);
          transportMode = "invalid-profile";
          const before = completions;
          await assert.rejects(generatePersonaDraft({ seed: "broken" }));
          assert.equal(completions - before, 2);
        } finally {
          transportMode = "normal";
        }
      },
    );
    await t.test(
      "Eight model evaluation scenarios persist outputs without changing the active model",
      async () => {
        const before = all("SELECT * FROM model_configurations ORDER BY task");
        const result = await ok(
          "POST",
          "/admin/model-evaluations",
          { providerId, modelId: "test/fixture" },
          owner,
        );
        assert.equal(result.status, "complete");
        assert.equal(result.results.length, 8);
        assert.ok(result.results.some((r: any) => r.needsHumanReview));
        assert.deepEqual(
          all("SELECT * FROM model_configurations ORDER BY task"),
          before,
        );
        assert.ok(
          (await ok("GET", "/admin/model-evaluations", undefined, owner))
            .length,
        );
      },
    );
    await t.test(
      "429: Retry-After persists, rejected calls cost zero and cooldown makes no extra request",
      async () => {
        const before = completions;
        try {
          transportMode = "rate";
          await assert.rejects(
            complete("message", [{ role: "user", content: "test" }]),
            (e: any) =>
              e.code === "PROVIDER_RATE_LIMIT" && e.retryAfterMs === 2000,
          );
          assert.ok(
            one("SELECT cooldown_until FROM providers WHERE id=?", providerId)!
              .cooldown_until > now(),
          );
          assert.equal(
            one(
              "SELECT cost FROM token_usage ORDER BY created_at DESC LIMIT 1",
            )!.cost,
            0,
          );
          await assert.rejects(
            complete("message", [{ role: "user", content: "test" }]),
            (e: any) => e.code === "PROVIDER_COOLDOWN",
          );
          assert.equal(completions, before + 1);
          run('UPDATE providers SET cooldown_until=0 WHERE id=?',providerId);transportMode='rate-long';
          await assert.rejects(complete('message',[{role:'user',content:'Long provider cooldown'}]),(e:any)=>e.retryAfterMs===7200000);
          assert.ok(one('SELECT cooldown_until FROM providers WHERE id=?',providerId)!.cooldown_until>=now()+7199000);
        } finally {
          transportMode = "normal";
          run("UPDATE providers SET cooldown_until=0 WHERE id=?", providerId);
        }
      },
    );
    await t.test(
      "Invalid generation pauses paid work instead of creating endless fresh jobs",
      async () => {
        const priorState = engine.simulation(),
          priorLimits = limits();
        const job = engine.enqueue(null, "generate", {}, 0, 100);
        try {
          transportMode = "empty";
          setSetting("limits", { ...priorLimits, maxActive: 1 });
          setSetting("simulation", {
            ...priorState,
            status: "running",
            mode: "live",
            target: agents.length,
          });
          const population = one("SELECT count(*) n FROM users")!.n;
          await engine.tick();
          assert.equal(
            one("SELECT status FROM ai_jobs WHERE id=?", job)!.status,
            "failed",
          );
          assert.equal(engine.simulation().status, "paused");
          const count = completions;
          await engine.tick();
          assert.equal(completions, count);
          assert.equal(one("SELECT count(*) n FROM users")!.n, population);
        } finally {
          transportMode = "normal";
          setSetting("limits", priorLimits);
          setSetting("simulation", priorState);
        }
      },
    );
    await t.test(
      "Five real 429 responses stop generation safely; no fresh job bypasses retry limit",
      async () => {
        const priorState = engine.simulation(),
          priorLimits = limits();
        const job = engine.enqueue(null, "generate", {}, 0, 100),
          before = completions;
        try {
          transportMode = "rate";
          setSetting("limits", { ...priorLimits, maxActive: 1 });
          setSetting("simulation", {
            ...priorState,
            status: "running",
            mode: "live",
            target: agents.length,
          });
          for (let attempt = 1; attempt <= 5; attempt++) {
            run("UPDATE providers SET cooldown_until=0 WHERE id=?", providerId);
            run("UPDATE ai_jobs SET run_at=0 WHERE id=?", job);
            await engine.tick();
            assert.equal(
              one("SELECT attempts FROM ai_jobs WHERE id=?", job)!.attempts,
              attempt,
            );
            assert.equal(
              one("SELECT status FROM ai_jobs WHERE id=?", job)!.status,
              attempt === 5 ? "failed" : "queued",
            );
          }
          assert.equal(completions, before + 5);
          assert.equal(engine.simulation().status, "paused");
          await engine.tick();
          assert.equal(completions, before + 5);
        } finally {
          transportMode = "normal";
          run("UPDATE providers SET cooldown_until=0 WHERE id=?", providerId);
          setSetting("limits", priorLimits);
          setSetting("simulation", priorState);
        }
      },
    );
    await t.test(
      "Unified model preset configures all tasks and clears per-agent overrides",
      async () => {
        const prior = limits();
        try {
          run(
            "UPDATE ai_personas SET model_id='old-invalid-model' WHERE user_id=?",
            agents[0],
          );
          await ok(
            "POST",
            "/admin/ai/use-model",
            {
              providerId,
              modelId: "test/fixture",
              rpm: 6,
              maxOutput: 4096,
              daily: 2,
              monthly: 20,
            },
            owner,
          );
          assert.equal(
            all(
              "SELECT * FROM model_configurations WHERE model_id='test/fixture'",
            ).length,
            5,
          );
          assert.equal(
            one("SELECT model_id FROM ai_personas WHERE user_id=?", agents[0])!
              .model_id,
            null,
          );
          assert.equal(limits().maxActive, 1);
          assert.equal(
            (
              await request(
                "POST",
                "/admin/ai/use-model",
                { providerId, modelId: "typo" },
                owner,
              )
            ).statusCode,
            400,
          );
          assert.equal(
            (
              await request(
                "POST",
                "/admin/ai/use-model",
                { providerId, modelId: "test/fixture" },
                other,
              )
            ).statusCode,
            403,
          );
        } finally {
          setSetting("limits", prior);
        }
      },
    );
    await t.test(
      "AI profile evolves with bounded trait changes and history; delegated transfer is confirmed through its own Notify",
      async () => {
        const { autonomyAction } =
            await import("../apps/server/src/ai/simulation/autonomy.js"),
          { processInbox } =
            await import("../apps/server/src/ai/simulation/inbox.js"),
          { createSpace } = await import("../apps/server/src/core.js"),
          { requestTransfer } =
            await import("../apps/server/src/messages/ownership.js");
        const uid = agents[7],
          agent = one(
            "SELECT p.*,u.status,u.display_name FROM ai_personas p JOIN users u ON u.id=p.user_id WHERE user_id=?",
            uid,
          ),
          before = JSON.parse(agent.traits).openness;
        try {
          transportMode = "self-profile";
          await autonomyAction(
            agent,
            { id: id(), payload: "{}" },
            "self_profile",
          );
          assert.equal(
            one("SELECT display_name FROM users WHERE id=?", uid)!.display_name,
            "Updated personality",
          );
          assert.ok(
            Math.abs(
              JSON.parse(
                one("SELECT traits FROM ai_personas WHERE user_id=?", uid)!
                  .traits,
              ).openness - before,
            ) <= 0.080001,
          );
          assert.equal(
            one(
              "SELECT count(*) n FROM profile_history WHERE user_id=? AND actor_type='self'",
              uid,
            )!.n,
            1,
          );
          const n = completions;
          await autonomyAction(
            { ...agent, customization_enabled: 0 },
            { id: id(), payload: "{}" },
            "self_profile",
          );
          assert.equal(completions, n);
          const channel = createSpace(owner.user.id, {
              kind: "channel",
              title: "Offer to a simulated participant",
            }),
            username = one(
              "SELECT username FROM users WHERE id=?",
              uid,
            )!.username;
          const transfer = requestTransfer(owner.user.id, channel, username);
          transportMode = "accept-transfer";
          await processInbox(agent, {
            id: id(),
            payload: JSON.stringify({
              eventIds: all(
                "SELECT id FROM notify_events WHERE user_id=?",
                uid,
              ).map((e) => e.id),
            }),
          });
          assert.equal(
            one("SELECT owner_id FROM spaces WHERE id=?", channel)!.owner_id,
            uid,
          );
          assert.equal(
            one("SELECT status FROM ownership_transfers WHERE id=?", transfer)!
              .status,
            "accepted",
          );
        } finally {
          transportMode = "normal";
        }
      },
    );
    await t.test(
      "Channel settings, private administration, reactions and real verification",
      async () => {
        const channel = await ok(
          "POST",
          "/spaces",
          {
            kind: "channel",
            title: "Owner studio",
            description: "",
            visibility: "public",
            members: [],
          },
          owner,
        );
        const channelOwner = (
          await ok("GET", "/spaces", undefined, owner)
        ).find((s: any) => s.id === channel.id);
        await ok(
          "PUT",
          `/spaces/${channel.id}/manage`,
          {
            title: "Crystal studio",
            description: "Updated",
            slug: channelOwner.slug,
            visibility: "public",
            rules: "",
            allowedReactions: ["🔥"],
          },
          owner,
        );
        await ok(
          "POST",
          `/spaces/${channel.id}/admins`,
          { username: other.user.username, action: "add", canPublish: false },
          owner,
        );
        assert.equal(
          (
            await request(
              "POST",
              `/spaces/${channel.id}/messages`,
              { text: "Denied" },
              other,
            )
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await request(
              "POST",
              `/spaces/${channel.id}/admins`,
              { username: third.user.username, action: "add" },
              other,
            )
          ).statusCode,
          403,
        );
        await ok(
          "POST",
          `/spaces/${channel.id}/admins`,
          { username: other.user.username, action: "add", canPublish: true },
          owner,
        );
        const post = await ok(
          "POST",
          `/spaces/${channel.id}/messages`,
          { text: "Published by administrator" },
          other,
        );
        assert.equal(
          (
            await request(
              "POST",
              `/messages/${post.id}/reactions`,
              { emoji: "👍" },
              owner,
            )
          ).statusCode,
          403,
        );
        await ok(
          "POST",
          `/messages/${post.id}/reactions`,
          { emoji: "🔥" },
          owner,
        );
        const messages = await ok(
          "GET",
          `/spaces/${channel.id}/messages`,
          undefined,
          owner,
        );
        assert.equal(messages[0].displayName, "Crystal studio");
        assert.equal(messages[0].senderId, channel.id);
        await ok(
          "POST",
          "/admin/actions",
          {
            targetType: "space",
            targetId: channel.id,
            action: "verification",
            reason: "Confirmed source",
            verification: {
              action: "grant",
              type: "standard",
              categoryId: "blogger",
            },
          },
          owner,
        );
        assert.equal(
          (await ok("GET", `/users/${owner.user.id}`, undefined, other))
            .verified,
          1,
        );
        assert.equal(
          (
            await request(
              "PUT",
              "/admin/verification",
              { targetId: agents[0], verified: true },
              owner,
            )
          ).statusCode,
          410,
        );
        const profile = await ok(
          "GET",
          `/spaces/${channel.id}/profile`,
          undefined,
          third,
        );
        assert.ok(!JSON.stringify(profile).includes(other.user.username));
        assert.equal(profile.admins, undefined);
        assert.equal(profile.owner_id, undefined);
        await ok(
          "POST",
          `/spaces/${channel.id}/admins`,
          { username: other.user.username, action: "remove" },
          owner,
        );
        assert.equal(
          (
            await request(
              "GET",
              `/spaces/${channel.id}/manage`,
              undefined,
              other,
            )
          ).statusCode,
          403,
        );
        const oldName = one(
          "SELECT display_name FROM users WHERE id=?",
          owner.user.id,
        )!.display_name;
        assert.equal(
          (
            await request(
              "PATCH",
              "/users/me",
              {
                displayName: "Should roll back",
                bio: "",
                language: "ru",
                username: other.user.username,
              },
              owner,
            )
          ).statusCode,
          409,
        );
        assert.equal(
          one("SELECT display_name FROM users WHERE id=?", owner.user.id)!
            .display_name,
          oldName,
        );
        const image = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        );
        const payload = Buffer.concat([
          Buffer.from(
            '--avatar\r\nContent-Disposition: form-data; name="file"; filename="avatar.png"\r\nContent-Type: image/png\r\n\r\n',
          ),
          image,
          Buffer.from("\r\n--avatar--\r\n"),
        ]);
        const upload = await app.inject({
          method: "POST",
          url: "/api/media",
          headers: {
            cookie: owner.cookie,
            "x-csrf-token": owner.csrf,
            "content-type": "multipart/form-data; boundary=avatar",
          },
          payload,
        });
        assert.equal(upload.statusCode, 200, upload.body);
        await ok(
          "PUT",
          `/spaces/${channel.id}/manage`,
          {
            title: "Crystal studio",
            description: "Updated",
            slug: channelOwner.slug,
            visibility: "public",
            rules: "",
            allowedReactions: ["🔥"],
            avatarId: upload.json().id,
          },
          owner,
        );
        const avatarResponse = await app.inject({
          url: `/media/${upload.json().id}`,
          headers: { cookie: third.cookie },
        });
        assert.equal(
          avatarResponse.statusCode,
          200,
          "Public channel avatars must be visible to other users",
        );
      },
    );
    await t.test(
      "G: persisted database survives a fresh process; interrupted tasks recover without catch-up storm",
      async () => {
        const before = one("SELECT count(*) n FROM messages")!.n;
        const jobId = engine.enqueue(agents[0], "activity");
        run("UPDATE ai_jobs SET status='running' WHERE id=?", jobId);
        const probe = spawnSync(
          process.execPath,
          ["--import", "tsx", "tests/restart-probe.ts"],
          {
            cwd: process.cwd(),
            env: { ...process.env },
            encoding: "utf8",
            timeout: 30000,
          },
        );
        assert.equal(probe.status, 0, probe.stderr);
        const result = JSON.parse(probe.stdout.trim().split("\n").at(-1)!);
        assert.equal(result.messages, before);
        assert.ok(result.memories > 0);
        assert.equal(result.recovered, true);
        assert.equal(setting("simulation", {} as any).status, "running");
        const backup = await ok("POST", "/admin/backup", {}, owner);
        assert.ok(
          existsSync(path.join(process.env.DATA_DIR!, "backups", backup.name)),
        );
        assert.equal(one("PRAGMA integrity_check")!.integrity_check, "ok");
        const restoreDirectory = mkdtempSync(
          path.resolve("test-results-restore-"),
        );
        const restore = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "scripts/restore.ts",
            path.join(process.env.DATA_DIR!, "backups", backup.name),
            "--confirm-offline",
          ],
          {
            env: { ...process.env, DATA_DIR: restoreDirectory },
            encoding: "utf8",
            timeout: 30000,
          },
        );
        assert.equal(restore.status, 0, restore.stderr);
        const restored = new Database(
          path.join(restoreDirectory, "orbit.sqlite"),
          { readonly: true },
        );
        assert.equal(
          (restored.prepare("SELECT count(*) n FROM messages").get() as any).n,
          before,
        );
        restored.close();
        const reset = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "scripts/reset-setup.ts",
            "--confirm-offline-reset",
          ],
          {
            env: { ...process.env, DATA_DIR: restoreDirectory },
            input: "Strong-test-password!",
            encoding: "utf8",
            timeout: 30000,
          },
        );
        assert.equal(reset.status, 0, reset.stderr);
        assert.equal(
          existsSync(path.join(restoreDirectory, "orbit.sqlite")),
          false,
        );
      },
    );
    await t.test(
      "100 deterministic personas: names, behavioral dimensions, interests, all five languages, duplicate detection",
      async () => {
        const profiles = Array.from({ length: 100 }, (_, i) =>
          syntheticPersona("diversity-" + i),
        );
        assert.equal(new Set(profiles.map((p) => p.username)).size, 100);
        assert.ok(new Set(profiles.map((p) => p.displayName)).size > 90);
        assert.equal(new Set(profiles.map((p) => p.language)).size, 5);
        assert.ok(
          new Set(profiles.map((p) => p.writing.averageLength)).size > 50,
        );
        assert.ok(new Set(profiles.flatMap((p) => p.interests)).size >= 10);
        assert.deepEqual(
          behavioralProfile("stable"),
          behavioralProfile("stable"),
        );
        assert.equal(tooSimilar("ок", ["ок"]), false);
        assert.equal(
          tooSimilar(
            "This is a long and repetitive message with identical phrasing for every single response",
            [
              "This is a long and repetitive message with identical phrasing for every single response",
            ],
          ),
          true,
        );
        for (const language of ["ru", "uk", "en", "it", "es"])
          assert.ok(profiles.some((p) => p.language === language));
        const samples = [];
        for (const p of profiles) {
          const response = await complete("message", [
            {
              role: "system",
              content: `Write in ${p.language}. This is an explicitly synthetic quality-test sample. Return JSON {"text":"..."}. Respect this writing profile: ${JSON.stringify(p.writing)}`,
            },
            {
              role: "user",
              content: "Discuss a drawing without inventing shared memories.",
            },
          ]);
          const text = JSON.parse(response.text).text;
          assert.match(text, /\[MOCK\]/);
          samples.push({ language: p.language, text });
        }
        assert.equal(samples.length, 100);
        assert.equal(new Set(samples.map((s) => s.text)).size, 100);
        assert.equal(new Set(samples.map((s) => s.language)).size, 5);
      },
    );
    await t.test(
      "Permissions, CSRF, upload MIME validation, bounded AI loops and export privacy",
      async () => {
        const denied = await request(
          "GET",
          "/admin/providers",
          undefined,
          other,
        );
        assert.equal(denied.statusCode, 403);
        const exportData = await ok("GET", "/admin/export", undefined, owner);
        assert.ok(!JSON.stringify(exportData).includes("private content"));
        assert.ok(!JSON.stringify(exportData).includes("password_hash"));
        const { queueReply } =
          await import("../apps/server/src/messages/service.js");
        const count = one("SELECT count(*) n FROM ai_jobs")!.n;
        queueReply(agents[0], groupId, "irrelevant", 4);
        assert.equal(one("SELECT count(*) n FROM ai_jobs")!.n, count);
        const data = Buffer.from(
          '--testboundary\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n<script>unsafe</script>\r\n--testboundary--\r\n',
        );
        const upload = await app.inject({
          method: "POST",
          url: "/api/media",
          headers: {
            cookie: owner.cookie,
            "x-csrf-token": owner.csrf,
            "content-type": "multipart/form-data; boundary=testboundary",
          },
          payload: data,
        });
        assert.equal(upload.statusCode, 400);
      },
    );
  } finally {
    engine.stopScheduler();
    await app.close();
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    sqlite.close();
  }
});
function txCreate<T>(fn: () => T) {
  return sqlite.transaction(fn).immediate();
}
