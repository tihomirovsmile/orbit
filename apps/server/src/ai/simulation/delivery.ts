import { all, one, run, tx, now } from "../../database/index.js";
import { io, member, activity, isBlocked } from "../../core.js";
import { sendMessage } from "../../messages/service.js";
import { capture } from "../memory/index.js";
export function readConversation(agentId: string, spaceId: string) {
  member(agentId, spaceId);
  tx(() => {
    run(
      "INSERT OR IGNORE INTO message_reads SELECT id,?,? FROM messages WHERE space_id=? AND deleted_at IS NULL",
      agentId,
      now(),
      spaceId,
    );
    run(
      "UPDATE space_members SET last_read_at=? WHERE space_id=? AND user_id=?",
      now(),
      spaceId,
      agentId,
    );
    run(
      "UPDATE users SET last_seen=?,presence_until=? WHERE id=?",
      now(),
      now() + 90000,
      agentId,
    );
    run(
      "INSERT INTO ai_visits(user_id,space_id,last_message_id,last_visited_at) VALUES(?,?,(SELECT id FROM messages WHERE space_id=? ORDER BY created_at DESC LIMIT 1),?) ON CONFLICT(user_id,space_id) DO UPDATE SET last_message_id=excluded.last_message_id,last_visited_at=excluded.last_visited_at,visits=visits+1",
      agentId,
      spaceId,
      spaceId,
      now(),
    );
    capture(agentId, spaceId);
  });
  io?.to("space:" + spaceId).emit("read", { spaceId });
}
export function delayReply(
  agent: any,
  job: any,
  spaceId: string,
  sourceId: string,
  text: string,
  depth: number,
) {
  const duration = Math.min(20000, Math.max(1800, text.length * 35));
  run(
    "UPDATE users SET presence_until=?,last_seen=? WHERE id=?",
    now() + duration + 30000,
    now(),
    agent.user_id,
  );
  run(
    "INSERT OR IGNORE INTO ai_deliveries(id,agent_id,space_id,source_id,payload,due_at,typing_until,created_at) VALUES(?,?,?,?,?,?,?,?)",
    job.id,
    agent.user_id,
    spaceId,
    sourceId,
    JSON.stringify({ text, depth }),
    now() + duration,
    now() + duration,
    now(),
  );
}
export function deliverPending(running: boolean) {
  for (const d of all(
    "SELECT d.*,u.status account_status,u.display_name,p.paused FROM ai_deliveries d JOIN users u ON u.id=d.agent_id JOIN ai_personas p ON p.user_id=d.agent_id WHERE d.status IN ('pending','held')",
  )) {
    let stop = d.account_status !== "active";
    try {
      const space = member(d.agent_id, d.space_id, true);
      if (space.kind === "dm") {
        const peer = one(
          "SELECT user_id FROM space_members WHERE space_id=? AND user_id!=?",
          d.space_id,
          d.agent_id,
        );
        if (peer && isBlocked(d.agent_id, peer.user_id)) stop = true;
      }
      if (
        !one(
          "SELECT id FROM messages WHERE id=? AND deleted_at IS NULL",
          d.source_id,
        )
      )
        stop = true;
    } catch {
      stop = true;
    }
    if (stop) {
      run("UPDATE ai_deliveries SET status='cancelled' WHERE id=?", d.id);
      io?.to("space:" + d.space_id).emit("typing", {
        spaceId: d.space_id,
        name: "",
        active: false,
      });
      continue;
    }
    if(!running||d.paused){run("UPDATE ai_deliveries SET status='held',typing_until=0 WHERE id=?",d.id);io?.to('space:'+d.space_id).emit('typing',{spaceId:d.space_id,name:'',active:false});continue;}
    if (d.status==='pending'&&d.due_at > now()) {
      io?.to("space:" + d.space_id).emit("typing", {
        spaceId: d.space_id,
        name: d.display_name,
        active: true,
        until: d.due_at,
      });
      continue;
    }
    try {
      tx(() => {
        const p = JSON.parse(d.payload);
        sendMessage(d.agent_id, d.space_id, p.text, {
          replyTo: d.source_id,
          jobId: d.id,
          depth: p.depth,
        });
        run("UPDATE ai_deliveries SET status='sent' WHERE id=?", d.id);
        activity(d.agent_id, "message", "Ответ после прочтения и набора");
      });
    } catch {
      run("UPDATE ai_deliveries SET status='cancelled' WHERE id=?", d.id);
    } finally {
      io?.to("space:" + d.space_id).emit("typing", {
        spaceId: d.space_id,
        name: "",
        active: false,
      });
    }
  }
}
