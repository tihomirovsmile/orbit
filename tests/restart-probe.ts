import { one, sqlite } from "../apps/server/src/database/index.js";
import {
  startScheduler,
  stopScheduler,
} from "../apps/server/src/ai/simulation/engine.js";
startScheduler();
stopScheduler();
console.log(
  JSON.stringify({
    messages: one("SELECT count(*) n FROM messages")!.n,
    memories: one("SELECT count(*) n FROM agent_memories")!.n,
    recovered: !one("SELECT 1 FROM ai_jobs WHERE status='running'"),
  }),
);
sqlite.close();
