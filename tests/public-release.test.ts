import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(path.resolve("test-results-public-"));
process.env.RUNTIME_CONFIG_FILE = path.join(
  process.env.DATA_DIR,
  "runtime.json",
);
process.env.ORBIT_DESKTOP_CONFIG_FILE = path.join(
  process.env.DATA_DIR,
  "launcher.ini",
);
const { buildApp } = await import("../apps/server/src/app.js");
const { run, one, id, now, sqlite } =
  await import("../apps/server/src/database/index.js");
const { sessionFor } = await import("../apps/server/src/auth/index.js");
const app = await buildApp();
function account(role: string) {
  const uid = id();
  run(
    "INSERT INTO users(id,username,display_name,type,role,created_at,last_seen) VALUES(?,?,?,'human',?,?,?)",
    uid,
    "u" + uid,
    "Person",
    role,
    now(),
    now(),
  );
  const s = sessionFor(uid);
  return {
    id: uid,
    headers: { cookie: "session=" + s.token, "x-csrf-token": s.csrf },
  };
}
const owner = account("OWNER"),
  mod = account("MODERATOR"),
  admin = account("ADMIN"),
  a = account("USER"),
  b = account("USER");
function request(
  actor: typeof owner,
  method: string,
  url: string,
  payload?: any,
) {
  return app.inject({
    method: method as any,
    url: "/api" + url,
    headers: actor.headers,
    payload,
  });
}
test("Final release: bulk authorization, retry safety, per-person results and desktop preferences", async (t) => {
  try {
    await t.test(
      "Bulk actions protect owner and staff, report partial success, and do not duplicate on retry",
      async () => {
        const body = {
          targetType: "user",
          targetIds: [a.id, admin.id, owner.id],
          action: "warn",
          reason: "Проверка правил сообщества",
          requestKey: id(),
        };
        const first = await request(mod, "POST", "/admin/actions/bulk", body);
        assert.equal(first.statusCode, 200, first.body);
        assert.deepEqual(
          first.json().results.map((r: any) => r.ok),
          [true, false, false],
        );
        const second = await request(mod, "POST", "/admin/actions/bulk", body);
        assert.deepEqual(first.json(), second.json());
        assert.equal(
          one(
            "SELECT count(*) n FROM moderation_decisions WHERE target_id=? AND action='warn'",
            a.id,
          )!.n,
          1,
        );
        assert.equal(
          (
            await request(mod, "POST", "/admin/actions/bulk", {
              ...body,
              reason: "Другая причина",
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await request(owner, "POST", "/admin/actions/bulk", {
              ...body,
              requestKey: id(),
              targetIds: [a.id, a.id],
            })
          ).statusCode,
          400,
        );
      },
    );
    await t.test(
      "Unprivileged access and role escalation are rejected",
      async () => {
        const body = {
          targetType: "user",
          targetIds: [b.id],
          action: "role",
          role: "ADMIN",
          reason: "Новая роль",
          requestKey: id(),
        };
        assert.equal(
          (await request(a, "POST", "/admin/actions/bulk", body)).statusCode,
          403,
        );
        const result = await request(mod, "POST", "/admin/actions/bulk", body);
        assert.equal(result.json().results[0].ok, false);
        assert.equal(
          one("SELECT role FROM users WHERE id=?", b.id)!.role,
          "USER",
        );
        const approved = await request(owner, "POST", "/admin/actions/bulk", {
          ...body,
          requestKey: id(),
        });
        assert.equal(approved.json().results[0].ok, true);
        assert.equal(
          one("SELECT role FROM users WHERE id=?", b.id)!.role,
          "ADMIN",
        );
      },
    );
    await t.test(
      "Desktop modes are validated, persisted and restricted to owner",
      async () => {
        assert.equal(
          (await request(mod, "PUT", "/desktop", { mode: "lan", ask: false }))
            .statusCode,
          403,
        );
        assert.equal(
          (
            await request(owner, "PUT", "/desktop", {
              mode: "invalid",
              ask: false,
            })
          ).statusCode,
          400,
        );
        const saved = await request(owner, "PUT", "/desktop", {
          mode: "lan",
          ask: false,
        });
        assert.equal(saved.statusCode, 200, saved.body);
        assert.equal(
          readFileSync(process.env.ORBIT_DESKTOP_CONFIG_FILE!, "utf8"),
          "mode=lan\nask=false\n",
        );
        assert.deepEqual((await request(owner, "GET", "/desktop")).json(), {
          available: true,
          mode: "lan",
          ask: false,
        });
      },
    );
    assert.equal(sqlite.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    await app.close();
    sqlite.close();
  }
});
