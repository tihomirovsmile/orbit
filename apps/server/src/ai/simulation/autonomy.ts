import { z } from "zod";
import { all, one, run, tx, id, now } from "../../database/index.js";
import { HttpError, activity, emit, member } from "../../core.js";
import { complete } from "../providers/service.js";
import { parseJSON } from "../personality/index.js";
import { reservedIdentity } from "../../../../../packages/shared/policy.js";
import { sendMessage } from "../../messages/service.js";
import { createReport } from "../../governance/reports.js";
import { createTicket } from "../../notify/tickets.js";
export async function autonomyAction(agent: any, job: any, action: string) {
  const uid = agent.user_id,
    payload = JSON.parse(job.payload);
  if (action === "self_profile") {
    if (
      !agent.customization_enabled ||
      now() - agent.last_profile_at < 6 * 3600000
    )
      return;
    const result = await complete(
      "planning",
      [
        {
          role: "system",
          content:
            "Reflect on actual social experience. You may evolve your own public profile, interests, goals, and numeric traits slightly. No required admiration or hostility toward owner. Do not invent private facts or personal credentials. Return ONLY JSON {change:boolean,reason:string,displayName?:string,bio?:string,interests?:string[],goals?:string[],traits?:{}}. Keep stable identity; traits change at most 0.08 per dimension.",
        },
        {
          role: "user",
          content: JSON.stringify({
            name: agent.display_name,
            biography: agent.biography,
            interests: JSON.parse(agent.interests),
            goals: JSON.parse(agent.goals),
            traits: JSON.parse(agent.traits),
            memories: all(
              "SELECT content FROM agent_memories WHERE user_id=? ORDER BY created_at DESC LIMIT 12",
              uid,
            ),
          }),
        },
      ],
      uid,
    );
    const p = z
      .object({
        change: z.boolean(),
        reason: z.string().min(3).max(600),
        displayName: z.string().trim().min(1).max(60).optional(),
        bio: z.string().max(600).optional(),
        interests: z.array(z.string().min(1).max(60)).min(1).max(12).optional(),
        goals: z.array(z.string().max(150)).max(8).optional(),
        traits: z.record(z.string(), z.number().min(0).max(1)).optional(),
      })
      .parse(parseJSON(result.text));
    run("UPDATE ai_personas SET last_profile_at=? WHERE user_id=?", now(), uid);
    if (!p.change) return;
    if (p.displayName && reservedIdentity(p.displayName))
      throw new HttpError(400, "Системное имя нельзя использовать");
    const before = one("SELECT display_name,bio FROM users WHERE id=?", uid),
      traits = JSON.parse(agent.traits);
    for (const [k, v] of Object.entries(p.traits || {}))
      if (typeof traits[k] === "number")
        traits[k] = Math.max(
          0,
          Math.min(
            1,
            Math.max(traits[k] - 0.08, Math.min(traits[k] + 0.08, v)),
          ),
        );
    tx(() => {
      run(
        "UPDATE users SET display_name=?,bio=? WHERE id=?",
        p.displayName || before.display_name,
        p.bio ?? before.bio,
        uid,
      );
      run(
        "UPDATE ai_personas SET interests=?,goals=?,traits=? WHERE user_id=?",
        JSON.stringify(p.interests || JSON.parse(agent.interests)),
        JSON.stringify(p.goals || JSON.parse(agent.goals)),
        JSON.stringify(traits),
        uid,
      );
      run(
        "INSERT INTO profile_history VALUES(?,?,?,?,?,?,?,?)",
        id(),
        uid,
        uid,
        "self",
        JSON.stringify({
          ...before,
          traits: JSON.parse(agent.traits),
          interests: JSON.parse(agent.interests),
        }),
        JSON.stringify(p),
        p.reason,
        now(),
      );
      activity(uid, "self_profile", p.reason);
    });
    emit();
    return;
  }
  if (action === "repost") {
    const source = payload.messageId
      ? one(
          "SELECT m.* FROM messages m JOIN spaces s ON s.id=m.space_id WHERE m.id=? AND m.deleted_at IS NULL AND s.visibility='public' AND s.frozen=0 AND s.delete_at IS NULL",
          payload.messageId,
        )
      : one(
          "SELECT m.* FROM messages m JOIN spaces s ON s.id=m.space_id JOIN ai_visits v ON v.space_id=s.id AND v.user_id=? WHERE m.deleted_at IS NULL AND s.visibility='public' AND s.frozen=0 AND s.delete_at IS NULL ORDER BY v.last_visited_at DESC,m.created_at DESC LIMIT 1",
          uid,
        );
    const target = one(
      "SELECT s.* FROM spaces s JOIN space_members m ON m.space_id=s.id WHERE m.user_id=? AND s.kind='group' AND s.frozen=0 AND s.delete_at IS NULL ORDER BY random() LIMIT 1",
      uid,
    );
    if (!source || !target || source.space_id === target.id) return;
    sendMessage(uid, target.id, "", {
      forwardedFrom: source.id,
      jobId: job.id,
      depth: 3,
    });
    activity(uid, "repost", "Поделился прочитанной публикацией");
    return;
  }
  if (action === "report") {
    const evidence = one(
      "SELECT m.*,s.kind,s.owner_id FROM messages m JOIN spaces s ON s.id=m.space_id JOIN ai_visits v ON v.space_id=s.id AND v.user_id=? WHERE m.sender_id!=? AND s.owner_id!=? AND m.deleted_at IS NULL AND s.visibility='public' AND s.frozen=0 AND s.delete_at IS NULL ORDER BY m.created_at DESC LIMIT 1",
      uid,
      uid,
      uid,
    );
    if (!evidence) return;
    const result = await complete(
      "moderation",
      [
        {
          role: "system",
          content:
            "Decide whether you personally want to report this actually read content. Do not manufacture violations. Disagreement alone is not fraud, spam or abuse. Return ONLY JSON {report:boolean,reasonCode:adult|fraud|spam|impersonation|security|threats|abuse|other,comment:string}. Reports go to a human; you never impose sanctions.",
        },
        {
          role: "user",
          content: JSON.stringify({
            traits: JSON.parse(agent.traits),
            content: evidence.text,
          }),
        },
      ],
      uid,
    );
    const p = z
      .object({
        report: z.boolean(),
        reasonCode: z.enum([
          "adult",
          "fraud",
          "spam",
          "impersonation",
          "security",
          "threats",
          "abuse",
          "other",
        ]),
        comment: z.string().max(2000),
      })
      .parse(parseJSON(result.text));
    if (p.report && p.comment.trim().length >= 3) {
      createReport(uid, {
        targetId:
          evidence.kind === "channel" ? evidence.space_id : evidence.sender_id,
        targetType: evidence.kind === "channel" ? "space" : "user",
        evidenceMessageId: evidence.id,
        ...p,
      });
      activity(
        uid,
        "report",
        "Отправил реальную публикацию на ручную проверку",
      );
    }
    return;
  }
  if (action === "request_deletion") {
    const events = all(
      "SELECT reason FROM moderation_decisions WHERE target_type='user' AND target_id=?",
      uid,
    );
    if (!events.length) return;
    const result = await complete(
      "planning",
      [
        {
          role: "system",
          content:
            "Given actual moderation history, decide whether this simulated participant has a serious sustained reason to request leaving the platform. No fabricated scandal. Return ONLY JSON {request:boolean,reason:string}. This only submits a support request, never deletes accounts.",
        },
        {
          role: "user",
          content: JSON.stringify({ traits: JSON.parse(agent.traits), events }),
        },
      ],
      uid,
    );
    const p = z
      .object({ request: z.boolean(), reason: z.string().max(3000) })
      .parse(parseJSON(result.text));
    if (
      p.request &&
      p.reason.trim().length >= 10 &&
      !one(
        "SELECT 1 FROM support_tickets WHERE user_id=? AND kind='deletion' AND status NOT IN ('rejected','closed','withdrawn')",
        uid,
      )
    )
      createTicket(uid, {
        kind: "deletion",
        subject: "Запрос покинуть Orbit",
        body: p.reason,
        requestKey: job.id,
      });
    return;
  }
  throw new HttpError(400, "Неизвестное самостоятельное действие");
}
