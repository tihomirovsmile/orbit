import { Readable } from "node:stream";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(path.resolve("test-results-master-"));
process.env.RUNTIME_CONFIG_FILE = path.join(
  process.env.DATA_DIR,
  "runtime.json",
);
const { buildApp } = await import("../apps/server/src/app.js");
const { all, one, run, id, now, sqlite, publicUser, setSetting } =
  await import("../apps/server/src/database/index.js");
const { sessionFor } = await import("../apps/server/src/auth/index.js");
const { createSpace } = await import("../apps/server/src/core.js");
const { sendMessage, getMessages } =
  await import("../apps/server/src/messages/service.js");
const governance = await import("../apps/server/src/governance/service.js");
const notify = await import("../apps/server/src/notify/service.js");
const tickets = await import("../apps/server/src/notify/tickets.js");
const ownership = await import("../apps/server/src/messages/ownership.js");
const { addComment, getComments } =
  await import("../apps/server/src/messages/comments.js");
const { validateAttachments, MiB } =
  await import("../apps/server/src/media/limits.js");
const app = await buildApp();
function account(name: string, role = "USER", type = "human") {
  const uid = id();
  run(
    "INSERT INTO users(id,username,display_name,type,role,avatar,bio,created_at,last_seen) VALUES(?,?,?,?,?,?,?,?,?)",
    uid,
    name,
    name,
    type,
    role,
    "/avatars/kept.svg",
    "Private kept bio",
    now(),
    now(),
  );
  notify.ensureNotify(uid);
  const s = sessionFor(uid);
  return {
    id: uid,
    headers: { cookie: "session=" + s.token, "x-csrf-token": s.csrf },
  };
}
const owner = account("master_owner", "OWNER"),
  a = account("alpha"),
  b = account("bravo"),
  mod = account("moderator", "MODERATOR"),
  support = account("supporter", "SUPPORT");
async function request(c: any, method: string, url: string, body?: any) {
  return app.inject({
    method: method as any,
    url: "/api" + url,
    headers: c.headers,
    payload: body,
  });
}
async function ok(c: any, method: string, url: string, body?: any) {
  const r = await request(c, method, url, body);
  assert.ok(r.statusCode < 300, r.statusCode + " " + r.body);
  return r.json();
}
function ticket(uid: string, kind = "support", extra: any = {}) {
  return tickets.createTicket(uid, {
    kind,
    subject: "Проверка обращения",
    body: "Подробное описание реального вопроса для поддержки",
    requestKey: id(),
    ...extra,
  });
}
test("Orbit 3 integrated lifecycle, permissions, privacy and bounded load", async (t) => {
  try {
    await t.test(
      "Schema 3 and immutable Notify: one welcome, idempotent delivery, high priority restores hidden inbox",
      async () => {
        assert.equal(sqlite.pragma("user_version", { simple: true }), 3);
        notify.ensureNotify(a.id);
        assert.equal(
          one(
            "SELECT count(*) n FROM notify_events WHERE user_id=? AND event_key='welcome'",
            a.id,
          )!.n,
          1,
        );
        assert.equal(
          one("SELECT count(*) n FROM users WHERE username='notify'")!.n,
          0,
        );
        run("UPDATE notify_inboxes SET hidden=1 WHERE user_id=?", a.id);
        const event = {
          key: "same",
          kind: "TEST",
          title: "Test",
          body: "Test",
          importance: "critical" as const,
        };
        assert.equal(
          notify.deliverNotify(a.id, event),
          notify.deliverNotify(a.id, event),
        );
        assert.equal(
          one("SELECT hidden FROM notify_inboxes WHERE user_id=?", a.id)!
            .hidden,
          0,
        );
        const r = await request(a, "POST", "/spaces", {
          kind: "channel",
          title: "Nоtify",
          slug: "notify_clone",
        });
        assert.equal(r.statusCode, 400);
      },
    );
    let channel: string, post: string;
    await t.test(
      "OWNER-only verified source; required media evidence; derived AI/user badges; no public ownership leaks",
      async () => {
        channel = createSpace(a.id, {
          kind: "channel",
          title: "News",
          slug: "master_news",
        });
        post = sendMessage(a.id, channel, "An independent source post");
        assert.throws(() =>
          governance.setVerification(mod.id, channel, {
            action: "grant",
            reason: "No permission",
          }),
        );
        assert.throws(() =>
          governance.setVerification(owner.id, channel, {
            action: "grant",
            categoryId: "media",
            country: "UA",
            reason: "Missing evidence",
          }),
        );
        governance.setVerification(owner.id, channel, {
          action: "grant",
          categoryId: "media",
          country: "UA",
          evidence: "https://example.org/public-source",
          reason: "Source checked",
        });
        assert.equal(
          publicUser(one("SELECT * FROM users WHERE id=?", a.id))!.verified,
          1,
        );
        const p = await ok(b, "GET", "/spaces/" + channel + "/profile");
        assert.equal(p.owner_id, undefined);
        assert.equal(p.admins, undefined);
        assert.equal(p.verification.country, "UA");
        assert.equal(
          (
            await request(mod, "POST", "/admin/actions", {
              targetType: "space",
              targetId: channel,
              action: "verification",
              reason: "Must be denied",
              verification: { action: "revoke" },
            })
          ).statusCode,
          403,
        );
      },
    );
    await t.test(
      "Multiple independent freezes, inherited community decisions, server-only Notify, original profile retained",
      async () => {
        governance.freezeTarget(owner.id, "user", a.id, {
          reason: "First actual review",
          reasonCode: "fraud",
        });
        const separate = governance.freezeTarget(mod.id, "space", channel, {
          reason: "Separate community review",
          reasonCode: "spam",
        });
        assert.equal(
          publicUser(one("SELECT * FROM users WHERE id=?", a.id))!.displayName,
          "DELETED",
        );
        assert.equal(
          one("SELECT display_name FROM users WHERE id=?", a.id)!.display_name,
          "alpha",
        );
        assert.equal(
          one("SELECT verified FROM spaces WHERE id=?", channel)!.verified,
          0,
        );
        for (const url of [
          "/discover",
          "/users/" + b.id,
          "/spaces/" + channel + "/messages",
          "/forum",
          "/admin/overview",
        ])
          assert.equal((await request(a, "GET", url)).statusCode, 403, url);
        assert.deepEqual(
          (await ok(a, "GET", "/spaces")).map((x: any) => x.id),
          ["notify"],
        );
        assert.ok((await ok(a, "GET", "/notify")).decisions.length >= 2);
        const own = one(
          "SELECT id FROM moderation_decisions WHERE target_type='user' AND target_id=? AND active=1",
          a.id,
        );
        governance.endDecision(owner.id, own.id, "Account reviewed");
        assert.equal(
          one("SELECT status FROM users WHERE id=?", a.id)!.status,
          "active",
        );
        assert.equal(
          one("SELECT frozen FROM spaces WHERE id=?", channel)!.frozen,
          1,
        );
        governance.endDecision(
          owner.id,
          separate,
          "Community reviewed separately",
        );
        assert.equal(
          one("SELECT frozen FROM spaces WHERE id=?", channel)!.frozen,
          0,
        );
        assert.equal(
          one("SELECT avatar FROM users WHERE id=?", a.id)!.avatar,
          "/avatars/kept.svg",
        );
        assert.equal(
          publicUser(one("SELECT * FROM users WHERE id=?", a.id))!.verified,
          0,
        );
      },
    );
    await t.test(
      "Appeals queue, rejection history, new evidence, self privacy, SUPPORT cannot alter decisions",
      async () => {
        const decision = governance.freezeTarget(owner.id, "user", a.id, {
          reason: "Appealable case",
          reasonCode: "other",
        });
        const key = id(),
          first = ticket(a.id, "appeal", {
            decisionId: decision,
            requestKey: key,
          });
        assert.equal(
          ticket(a.id, "appeal", { decisionId: decision, requestKey: key }),
          first,
        );
        const second = ticket(a.id, "data");
        assert.equal(
          one("SELECT status FROM support_tickets WHERE id=?", second)!.status,
          "queued",
        );
        assert.throws(() => tickets.getTicket(b.id, first));
        tickets.updateTicket(owner.id, first, {
          action: "assign",
          assigneeId: support.id,
        });
        assert.equal(
          (await request(support, "GET", "/admin/overview")).statusCode,
          403,
        );
        assert.throws(() =>
          tickets.updateTicket(support.id, first, {
            action: "accepted",
            reason: "Unauthorized reversal",
          }),
        );
        tickets.replyTicket(
          support.id,
          first,
          { body: "Please provide context.", requestKey: key },
          true,
        );
        const own = tickets.getTicket(a.id, first);
        assert.equal(own.assigned_to, undefined);
        assert.ok(!JSON.stringify(own).includes("supporter"));
        tickets.updateTicket(owner.id, first, {
          action: "rejected",
          reason: "Insufficient evidence",
        });
        assert.throws(() => ticket(a.id, "appeal", { decisionId: decision }));
        const next = ticket(a.id, "appeal", {
          decisionId: decision,
          newEvidence: true,
        });
        assert.equal(
          one("SELECT status FROM support_tickets WHERE id=?", next)!.status,
          "queued",
        );
        tickets.updateTicket(owner.id, second, {
          action: "closed",
          reason: "Data request complete",
        });
        assert.equal(
          one("SELECT status FROM support_tickets WHERE id=?", next)!.status,
          "active",
        );
        tickets.updateTicket(owner.id, next, {
          action: "accepted",
          reason: "New evidence confirms error",
        });
        assert.equal(
          one("SELECT status FROM users WHERE id=?", a.id)!.status,
          "active",
        );
      },
    );
    await t.test(
      "Timed sanctions expire after downtime and repeated maintenance has no duplicate effects",
      () => {
        const d = governance.freezeTarget(owner.id, "user", a.id, {
          reason: "Temporary",
          reasonCode: "security",
          durationHours: 1,
        });
        governance.maintainGovernance(now() + 3600001);
        assert.equal(
          one("SELECT active FROM moderation_decisions WHERE id=?", d)!.active,
          0,
        );
        assert.equal(
          one("SELECT status FROM users WHERE id=?", a.id)!.status,
          "active",
        );
        const n = one("SELECT count(*) n FROM notify_events")!.n;
        governance.maintainGovernance(now() + 3600001);
        assert.equal(one("SELECT count(*) n FROM notify_events")!.n, n);
      },
    );
    await t.test(
      "Comments: internal and linked private group, old history retained, restricted reactions and author signatures",
      async () => {
        run(
          "UPDATE spaces SET comments_mode='internal',show_author=1 WHERE id=?",
          channel,
        );
        await ok(b, "POST", "/spaces/" + channel + "/join", {});
        const key = id();
        addComment(b.id, post, "Internal comment", key);
        assert.equal(addComment(b.id, post, "Internal comment", key), key);
        assert.equal(getComments(b.id, post).length, 1);
        const group = createSpace(a.id, {
          kind: "group",
          title: "Private discussion",
          visibility: "private",
        });
        run(
          "UPDATE spaces SET comments_mode='group',discussion_id=? WHERE id=?",
          group,
          channel,
        );
        assert.throws(() => getComments(b.id, post));
        run(
          "INSERT INTO space_members(space_id,user_id,joined_at) VALUES(?,?,?)",
          group,
          b.id,
          now(),
        );
        addComment(b.id, post, "Group comment");
        assert.equal(getComments(b.id, post).length, 2);
        assert.equal(
          one("SELECT count(*) n FROM messages WHERE space_id=?", group)!.n,
          1,
        );
        run(
          "UPDATE spaces SET comments_mode='none',reactions_enabled=0 WHERE id=?",
          channel,
        );
        assert.throws(() => addComment(b.id, post, "Disabled"));
        assert.equal(
          (
            await request(b, "POST", "/messages/" + post + "/reactions", {
              emoji: "❤",
            })
          ).statusCode,
          403,
        );
        assert.equal(getMessages(a.id, channel)[0].signature, "alpha");
      },
    );
    await t.test(
      "Two-party ownership transfer, no premature owner change, source status suspended",
      () => {
        governance.setVerification(owner.id, channel, {
          action: "grant",
          categoryId: "company",
          reason: "Confirmed company",
        });
        const transfer = ownership.requestTransfer(a.id, channel, "bravo");
        assert.equal(
          one("SELECT owner_id FROM spaces WHERE id=?", channel)!.owner_id,
          a.id,
        );
        assert.throws(() =>
          ownership.resolveTransfer(a.id, transfer, "accept"),
        );
        ownership.resolveTransfer(b.id, transfer, "accept");
        assert.equal(
          one("SELECT owner_id FROM spaces WHERE id=?", channel)!.owner_id,
          b.id,
        );
        assert.equal(
          one("SELECT verified FROM spaces WHERE id=?", channel)!.verified,
          0,
        );
        assert.equal(
          one(
            "SELECT role FROM space_members WHERE space_id=? AND user_id=?",
            channel,
            a.id,
          )!.role,
          "member",
        );
        assert.throws(() =>
          ownership.resolveTransfer(b.id, transfer, "accept"),
        );
      },
    );
    await t.test(
      "Channel deletion: cancel, persistent deadline, independent forwarded copies, repeated maintenance safe",
      () => {
        const dm = createSpace(a.id, {
          kind: "dm",
          title: "Copies",
          members: [b.id],
        });
        const copy = sendMessage(a.id, dm, "", { forwardedFrom: post });
        assert.throws(() => governance.requestChannelDeletion(a.id, channel));
        const due = governance.requestChannelDeletion(b.id, channel);
        assert.ok(due >= now() + 29000);
        assert.throws(() =>
          sendMessage(b.id, channel, "Blocked during countdown"),
        );
        governance.cancelChannelDeletion(b.id, channel);
        assert.equal(
          one("SELECT delete_at FROM spaces WHERE id=?", channel)!.delete_at,
          null,
        );
        governance.requestChannelDeletion(b.id, channel);
        governance.maintainGovernance(now() + 31000);
        assert.equal(
          one("SELECT id FROM spaces WHERE id=?", channel),
          undefined,
        );
        const forwarded = one("SELECT * FROM messages WHERE id=?", copy);
        assert.equal(forwarded.text, "An independent source post");
        assert.equal(forwarded.forwarded_from, null);
        governance.maintainGovernance(now() + 31000);
      },
    );
    await t.test(
      "Account deletion: OWNER only, owned community blocker, cancellable hour, all DMs/messages/Notify gone",
      async () => {
        const u = account("erase_me"),
          other = account("keep_me");
        const owned = createSpace(u.id, {
          kind: "channel",
          title: "Must transfer",
        });
        assert.throws(() =>
          governance.approveAccountDeletion(owner.id, u.id, "Requested"),
        );
        governance.requestChannelDeletion(u.id, owned);
        governance.maintainGovernance(now() + 31000);
        const dm = createSpace(other.id, {
          kind: "dm",
          title: "Erase chat",
          members: [u.id],
        });
        const assetId = id(),
          assetPath = path.join(
            process.env.DATA_DIR!,
            "uploads",
            assetId + ".bin",
          );
        writeFileSync(assetPath, "private content");
        run(
          "INSERT INTO media_assets(id,owner_id,filename,original_name,mime,size,created_at) VALUES(?,?,?,?,?,?,?)",
          assetId,
          u.id,
          assetId + ".bin",
          "private.txt",
          "text/plain",
          15,
          now(),
        );
        const privateMessage = sendMessage(u.id, dm, "Private PII", {
          mediaIds: [assetId],
        });
        const observer = id();
        const { generateAgent } =
          await import("../apps/server/src/ai/simulation/engine.js");
        await generateAgent({
          id: observer,
          payload: JSON.stringify({
            manualProfile: {
              displayName: "Observer",
              username: "observer_memory",
              interests: ["art"],
            },
          }),
        });
        run(
          "INSERT INTO agent_memories VALUES(?,?,?,?,?,?,?,?)",
          id(),
          observer,
          u.id,
          "episodic",
          "Private PII from removed account",
          0.6,
          privateMessage,
          now(),
        );
        run(
          "UPDATE ai_personas SET summary='Private PII summary' WHERE user_id=?",
          observer,
        );
        sendMessage(other.id, dm, "Other reply");
        ticket(u.id);
        assert.throws(() =>
          governance.approveAccountDeletion(mod.id, u.id, "No owner power"),
        );
        const due = governance.approveAccountDeletion(
          owner.id,
          u.id,
          "Actual request approved",
        );
        assert.equal(
          publicUser(one("SELECT * FROM users WHERE id=?", u.id))!.displayName,
          "DELETED",
        );
        assert.equal(
          (await request(u, "GET", "/notifications")).statusCode,
          403,
        );
        governance.cancelAccountDeletion(u.id);
        assert.equal(
          one("SELECT status FROM users WHERE id=?", u.id)!.status,
          "active",
        );
        governance.approveAccountDeletion(owner.id, u.id, "Approved again");
        governance.maintainGovernance(due + 10000);
        assert.equal(one("SELECT id FROM users WHERE id=?", u.id), undefined);
        assert.equal(one("SELECT id FROM spaces WHERE id=?", dm), undefined);
        assert.equal(existsSync(assetPath), false);
        assert.equal(
          one(
            "SELECT count(*) n FROM agent_memories WHERE user_id=?",
            observer,
          )!.n,
          0,
        );
        assert.equal(
          one("SELECT summary FROM ai_personas WHERE user_id=?", observer)!
            .summary,
          "",
        );
        assert.equal(
          one("SELECT count(*) n FROM notify_events WHERE user_id=?", u.id)!.n,
          0,
        );
        assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
      },
    );
    await t.test(
      "Media sums and local CDN auth, MIME, byte ranges and support attachments",
      async () => {
        const make = (size: number, mime = "image/png") => {
          const mid = id();
          writeFileSync(
            path.join(process.env.DATA_DIR!, "uploads", mid + ".bin"),
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
          );
          run(
            "INSERT INTO media_assets(id,owner_id,filename,original_name,mime,size,created_at) VALUES(?,?,?,?,?,?,?)",
            mid,
            a.id,
            mid + ".bin",
            "sample",
            mime,
            size,
            now(),
          );
          return mid;
        };
        const photo = make(3 * MiB),
          photo2 = make(3 * MiB),
          photo3 = make(1);
        assert.doesNotThrow(() => validateAttachments([photo, photo2]));
        assert.throws(() => validateAttachments([photo, photo2, photo3]));
        assert.throws(() => validateAttachments([make(3 * MiB + 1)]));
        assert.throws(() =>
          validateAttachments([make(801 * MiB, "video/mp4")]),
        );
        const media = make(12);
        let r = await app.inject({
          method: "GET",
          url: "/media/" + media,
          headers: b.headers,
        });
        assert.equal(r.statusCode, 403);
        r = await app.inject({
          method: "GET",
          url: "/media/" + media,
          headers: { ...a.headers, range: "bytes=0-3" },
        });
        assert.equal(r.statusCode, 206);
        assert.equal(r.rawPayload.length, 4);
        r = await app.inject({
          method: "GET",
          url: "/media/" + media,
          headers: { ...a.headers, range: "bytes=99-100" },
        });
        assert.equal(r.statusCode, 416);
      },
    );
    await t.test(
      "Streaming upload enforces per-file limits and removes partial data; frozen users can attach only through Notify",
      async () => {
        const before = readdirSync(
          path.join(process.env.DATA_DIR!, "uploads"),
        ).length;
        async function* chunks() {
          yield Buffer.from(
            '--streamboundary\r\nContent-Disposition: form-data; name="file"; filename="large.txt"\r\nContent-Type: text/plain\r\n\r\n',
          );
          for (let i = 0; i < 512; i++) yield Buffer.alloc(65536, 97);
          yield Buffer.from("\r\n--streamboundary--\r\n");
        }
        const r = await app.inject({
          method: "POST",
          url: "/api/media",
          headers: {
            ...a.headers,
            "content-type": "multipart/form-data; boundary=streamboundary",
          },
          payload: Readable.from(chunks()),
        });
        assert.equal(r.statusCode, 413, r.body);
        assert.equal(
          readdirSync(path.join(process.env.DATA_DIR!, "uploads")).length,
          before,
        );
        const decision = governance.freezeTarget(owner.id, "user", a.id, {
          reasonCode: "other",
          reason: "Attachment isolation test",
        });
        const data = Buffer.from(
          '--smallboundary\r\nContent-Disposition: form-data; name="file"; filename="proof.txt"\r\nContent-Type: text/plain\r\n\r\nEvidence for this actual appeal.\r\n--smallboundary--\r\n',
        );
        const headers = {
          ...a.headers,
          "content-type": "multipart/form-data; boundary=smallboundary",
        };
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/media",
              headers,
              payload: data,
            })
          ).statusCode,
          403,
        );
        const upload = await app.inject({
          method: "POST",
          url: "/api/notify/media",
          headers,
          payload: data,
        });
        assert.equal(upload.statusCode, 200, upload.body);
        const asset = upload.json();
        const tid = ticket(a.id, "appeal", {
          decisionId: decision,
          mediaIds: [asset.id],
        });
        assert.ok(
          tickets
            .getTicket(a.id, tid)
            .media.some((m: any) => m.id === asset.id),
        );
        assert.equal(
          (
            await app.inject({
              method: "GET",
              url: "/media/" + asset.id,
              headers: b.headers,
            })
          ).statusCode,
          403,
        );
        tickets.updateTicket(owner.id, tid, {
          action: "accepted",
          reason: "Isolation test completed",
        });
      },
    );
    await t.test(
      "Manual AI profile, birth date age, derived badge eligibility, isolated history and permissions",
      async () => {
        const profile = {
          displayName: "My custom personality",
          username: "custom_persona",
          bio: "",
          birthDate: "1995-11-14",
          interests: ["music"],
        };
        const result = await ok(owner, "POST", "/admin/personas", {
          profile,
          behavior: {
            language: "ru",
            traits: { energy: 0.9, initiative: 0.8, chaos: 0.2 },
          },
        });
        const uid = result.id;
        assert.equal(one("SELECT type FROM users WHERE id=?", uid)!.type, "ai");
        assert.equal(
          one("SELECT birth_date FROM users WHERE id=?", uid)!.birth_date,
          "1995-11-14",
        );
        const s = createSpace(uid, { kind: "channel", title: "AI source" });
        governance.setVerification(owner.id, s, {
          action: "grant",
          categoryId: "blogger",
          reason: "Confirmed simulated source",
        });
        assert.equal(
          publicUser(one("SELECT * FROM users WHERE id=?", uid))!.verified,
          1,
        );
        assert.equal(
          one("SELECT verified FROM users WHERE id=?", uid)!.verified,
          0,
        );
        assert.equal(
          (await request(mod, "POST", "/admin/personas", { profile }))
            .statusCode,
          403,
        );
        assert.equal(
          (await request(owner, "POST", "/admin/personas", { profile }))
            .statusCode,
          409,
        );
      },
    );
    await t.test(
      "Read without reply and addressed delayed typing, delivery pause and idempotent send",
      async () => {
        const { readConversation, delayReply, deliverPending } =
          await import("../apps/server/src/ai/simulation/delivery.js");
        const { generateAgent } =
          await import("../apps/server/src/ai/simulation/engine.js");
        const uid = id();
        await generateAgent({
          id: uid,
          payload: JSON.stringify({
            manualProfile: {
              displayName: "Read agent",
              username: "read_agent",
              interests: ["art"],
            },
          }),
        });
        const dm = createSpace(a.id, {
            kind: "dm",
            title: "Targeted typing",
            members: [uid],
          }),
          source = sendMessage(a.id, dm, "A message worth reading");
        readConversation(uid, dm);
        assert.ok(
          one(
            "SELECT 1 FROM message_reads WHERE message_id=? AND user_id=?",
            source,
            uid,
          ),
        );
        assert.equal(
          one(
            "SELECT count(*) n FROM messages WHERE space_id=? AND sender_id=?",
            dm,
            uid,
          )!.n,
          0,
        );
        const job = { id: id() };
        delayReply({ user_id: uid }, job, dm, source, "Actual reply", 1);
        deliverPending(false);
        assert.equal(
          one("SELECT status FROM ai_deliveries WHERE id=?", job.id)!.status,
          "held",
        );
        deliverPending(true);deliverPending(true);assert.equal(one('SELECT count(*) n FROM messages WHERE job_id=?',job.id)!.n,1);
        const job2 = { id: id() };
        delayReply({ user_id: uid }, job2, dm, source, "Reply only once", 1);
        run("UPDATE ai_deliveries SET due_at=0 WHERE id=?", job2.id);
        deliverPending(true);
        deliverPending(true);
        assert.equal(
          one("SELECT count(*) n FROM messages WHERE job_id=?", job2.id)!.n,
          1,
        );
      },
    );
    await t.test(
      "Independent price limits, unknown price handling and router aliases excluded",
      async () => {
        const { catalogFilter } =
          await import("../packages/shared/model-recommendations.js");
        const rows = [
          {
            id: "large-120b",
            providerKind: "direct",
            pricing: { prompt: "0.0000002", completion: "0.0000002" },
          },
          {
            id: "expensive-120b",
            providerKind: "direct",
            pricing: { prompt: "0.0000001", completion: "0.0000006" },
          },
          {
            id: "openrouter/auto",
            providerKind: "direct",
            pricing: { prompt: "0", completion: "0" },
          },
          { id: "unknown-120b", providerKind: "direct" },
        ];
        const result = catalogFilter(rows, {
          providerKind: "direct",
          budget: "true",
          excludeSmall: "true",
        });
        assert.deepEqual(
          result.map((m) => m.id),
          ["large-120b"],
        );
      },
    );
    await t.test(
      "Audit is readable, secret fields redacted, bounded 1000-event maintenance and FK integrity",
      async () => {
        const start = performance.now();
        for (let n = 0; n < 1000; n++)
          notify.deliverNotify(a.id, {
            key: "load:" + n,
            kind: "TEST",
            title: "Load test",
            body: "Bounded fixture",
          });
        governance.maintainGovernance();
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 15000, "1000 events " + elapsed + "ms");
        const result = await ok(owner, "GET", "/admin/audit-log");
        assert.ok(
          result.items.some((x: any) => x.summary.includes("заморозил")),
        );
        assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
        assert.equal(sqlite.pragma("integrity_check", { simple: true }), "ok");
        console.log(
          "Measured 1000 Notify events + maintenance:",
          Math.round(elapsed),
          "ms",
        );
      },
    );
  } finally {
    await app.close();
    sqlite.close();
  }
});
