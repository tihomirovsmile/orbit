import { all, one, run, now, id } from "../../database/index.js";
import { rememberInteraction } from "../../messages/service.js";
export function relevantMemory(agentId: string, targetId?: string) {
  return all(
    "SELECT kind,content FROM agent_memories WHERE user_id=? ORDER BY (target_id=?) DESC,importance DESC,created_at DESC LIMIT 12",
    agentId,
    targetId || "",
  )
    .map((x) => `${x.kind}: ${x.content}`)
    .join("\n")
    .slice(0, 3500);
}
export function capture(agentId: string, spaceId: string) {
  const rows = all(
    "SELECT m.id,m.text,m.sender_id,u.display_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE space_id=? AND sender_id!=? AND deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 8",
    spaceId,
    agentId,
  );
  for (const m of rows)
    rememberInteraction(
      agentId,
      m.sender_id,
      `${m.display_name}: ${m.text.slice(0, 500)}`,
      m.id,
    );
  for (const m of rows) {
    const rel = one(
      "SELECT interactions FROM relationships WHERE user_id=? AND target_id=?",
      agentId,
      m.sender_id,
    );
    if (rel?.interactions >= 10) {
      const memoryId = `${agentId}:semantic:${m.sender_id}`;
      run(
        "INSERT INTO agent_memories VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,created_at=excluded.created_at",
        memoryId,
        agentId,
        m.sender_id,
        "semantic",
        `I have read ${rel.interactions} messages from ${m.display_name}; this is based on recorded interactions, not assumed friendship.`,
        0.85,
        "relationship:" + m.sender_id,
        now(),
      );
    }
  }
  const older = all(
    "SELECT id,content FROM agent_memories WHERE user_id=? AND importance<0.8 ORDER BY created_at DESC LIMIT 100 OFFSET 60",
    agentId,
  );
  if (older.length) {
    const summary = older
      .map((x) => x.content)
      .join("\n")
      .slice(0, 4500);
    run("UPDATE ai_personas SET summary=? WHERE user_id=?", summary, agentId);
    for (const m of older) run("DELETE FROM agent_memories WHERE id=?", m.id);
    if (
      one("SELECT 1 FROM model_configurations WHERE task='memory'") &&
      !one(
        "SELECT 1 FROM ai_jobs WHERE agent_id=? AND kind='memory' AND status IN ('queued','running')",
        agentId,
      )
    )
      run(
        "INSERT INTO ai_jobs(id,agent_id,kind,payload,priority,run_at,created_at) VALUES(?,?,'memory','{}',-1,?,?)",
        id(),
        agentId,
        now() + 30000,
        now(),
      );
  }
}
