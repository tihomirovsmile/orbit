import { readFileSync, writeFileSync, renameSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOwner, HttpError } from "./core.js";
const preferences = z.object({
  mode: z.enum(["app", "local", "lan"]),
  ask: z.boolean(),
});
export async function desktopRoutes(app: FastifyInstance) {
  app.get("/api/desktop", async (req) => {
    requireOwner(req);
    const file = process.env.ORBIT_DESKTOP_CONFIG_FILE;
    if (!file) return { available: false };
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {}
    const mode = /^mode=(app|local|lan)$/m.exec(text)?.[1] || "app";
    return { available: true, mode, ask: !/^ask=false$/m.test(text) };
  });
  app.put("/api/desktop", async (req) => {
    requireOwner(req);
    const file = process.env.ORBIT_DESKTOP_CONFIG_FILE;
    if (!file)
      throw new HttpError(
        400,
        "Эта настройка доступна в настольном приложении",
      );
    const b = preferences.parse(req.body);
    writeFileSync(file + ".tmp", `mode=${b.mode}\nask=${b.ask}\n`, {
      mode: 0o600,
    });
    renameSync(file + ".tmp", file);
    return { ok: true };
  });
}
