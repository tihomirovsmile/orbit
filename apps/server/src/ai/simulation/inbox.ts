import { z } from "zod";
import { all, one, run, now, id } from "../../database/index.js";
import { activity, HttpError } from "../../core.js";
import { complete } from "../providers/service.js";
import { parseJSON } from "../personality/index.js";
import { createTicket, replyTicket } from "../../notify/tickets.js";
import { resolveTransfer } from "../../messages/ownership.js";
export function queueInboxTasks() {
  for (const a of all(
    "SELECT p.user_id FROM ai_personas p JOIN users u ON u.id=p.user_id WHERE p.paused=0 AND u.status IN ('active','banned','restricted') AND EXISTS(SELECT 1 FROM notify_events e WHERE e.user_id=p.user_id AND e.delivered_at IS NULL AND e.kind IN ('ACCOUNT_FROZEN','CHANNEL_FROZEN','OWNERSHIP_TRANSFER','APPEAL_UPDATED')) AND NOT EXISTS(SELECT 1 FROM ai_jobs j WHERE j.agent_id=p.user_id AND j.kind='notify' AND j.status IN ('queued','running')) LIMIT 5",
  )) {
    const events = all(
      "SELECT id FROM notify_events WHERE user_id=? AND delivered_at IS NULL AND kind IN ('ACCOUNT_FROZEN','CHANNEL_FROZEN','OWNERSHIP_TRANSFER','APPEAL_UPDATED')",
      a.user_id,
    );
    run(
      "INSERT INTO ai_jobs(id,agent_id,kind,payload,priority,run_at,created_at) VALUES(?,?,'notify',?,11,?,?)",
      id(),
      a.user_id,
      JSON.stringify({ eventIds: events.map((e) => e.id) }),
      now(),
      now(),
    );
    for (const e of events)
      run("UPDATE notify_events SET delivered_at=? WHERE id=?", now(), e.id);
  }
}
export async function processInbox(agent: any, job: any) {
  const uid = agent.user_id,
    payload = JSON.parse(job.payload),
    events = all(
      "SELECT id,kind,title,body,decision_id,payload FROM notify_events WHERE user_id=? ORDER BY created_at DESC LIMIT 12",
      uid,
    ),
    decisions = all(
      "SELECT id,reason,target_type,target_id FROM moderation_decisions WHERE active=1 AND ((target_type='user' AND target_id=?) OR (target_type='space' AND target_id IN(SELECT id FROM spaces WHERE owner_id=?)))",
      uid,
      uid,
    ),
    transfers = all(
      "SELECT t.id,s.title,t.from_id,t.to_id FROM ownership_transfers t JOIN spaces s ON s.id=t.space_id WHERE t.to_id=? AND t.status='pending' AND t.expires_at>?",
      uid,
      now(),
    ),
    tickets = all(
      "SELECT id,subject,status FROM support_tickets WHERE user_id=? AND status NOT IN ('accepted','rejected','closed','withdrawn')",
      uid,
    ).map((t) => ({
      ...t,
      messages: all(
        "SELECT author_type,body FROM ticket_messages WHERE ticket_id=? ORDER BY created_at DESC LIMIT 6",
        t.id,
      ),
    }));
  const result = await complete(
    "planning",
    [
      {
        role: "system",
        content:
          "Handle your Notify inbox as an ordinary simulated user, never as staff. Use only actual events and IDs supplied below. You may do nothing, appeal an active decision, reply to your own support ticket, or accept/reject an offered community transfer if your account is active. Never invent evidence or a scandal. No required sympathy for the creator. Return ONLY JSON {action:none|appeal|reply|accept_transfer|reject_transfer,id?:string,body?:string}. A refusal of a transfer is final; acceptance changes ownership.",
      },
      {
        role: "user",
        content: JSON.stringify({
          status: agent.status,
          traits: JSON.parse(agent.traits),
          events,
          decisions,
          transfers,
          tickets,
        }),
      },
    ],
    uid,
  );
  const value = z
    .object({
      action: z.enum([
        "none",
        "appeal",
        "reply",
        "accept_transfer",
        "reject_transfer",
      ]),
      id: z.string().optional(),
      body: z.string().max(10000).optional(),
    })
    .parse(parseJSON(result.text));
  if (value.action === "appeal") {
    if (!decisions.some((d) => d.id === value.id))
      throw new HttpError(
        400,
        "Нет такого действующего решения в личном Notify",
      );
    if (!value.body || value.body.length < 10)
      throw new HttpError(422, "Нет объяснения апелляции");
    createTicket(uid, {
      kind: "appeal",
      decisionId: value.id,
      subject: "Прошу пересмотреть решение",
      body: value.body,
      requestKey: job.id,
    });
  }
  if (value.action === "reply") {
    if (!tickets.some((t) => t.id === value.id))
      throw new HttpError(400, "Нет такого личного обращения");
    if (!value.body?.trim()) throw new HttpError(422, "Нет текста ответа");
    replyTicket(uid, value.id!, { body: value.body, requestKey: job.id });
  }
  if (
    value.action === "accept_transfer" ||
    value.action === "reject_transfer"
  ) {
    if (!transfers.some((t) => t.id === value.id))
      throw new HttpError(400, "Нет такого предложения владения");
    resolveTransfer(
      uid,
      value.id!,
      value.action === "accept_transfer" ? "accept" : "reject",
    );
  }
  for (const eventId of payload.eventIds || [])
    run(
      "UPDATE notify_events SET read_at=coalesce(read_at,?) WHERE id=? AND user_id=?",
      now(),
      eventId,
      uid,
    );
  activity(
    uid,
    "notify_read",
    "Прочитал адресные события Notify и выбрал допустимое действие",
  );
}
