import "dotenv/config";
import "./runtime.js";
import { buildApp } from "./app.js";
import { startScheduler, stopScheduler } from "./ai/simulation/engine.js";
import { dataDir } from "./database/index.js";
import { lockDirectory } from "./database/lock.js";
const releaseLock = lockDirectory(dataDir);
process.on("exit", releaseLock);
const host = process.env.HOST || "127.0.0.1",
  port = Number(process.env.PORT || 3000);
if (
  process.env.NODE_ENV === "production" &&
  host !== "127.0.0.1" &&
  host !== "localhost" &&
  (!process.env.PUBLIC_ORIGIN ||
    !process.env.PUBLIC_ORIGIN.startsWith("https://") ||
    process.env.SECURE_COOKIE !== "true")
)
  throw new Error(
    "External production access requires HTTPS PUBLIC_ORIGIN and SECURE_COOKIE=true",
  );
const app = await buildApp();
await app.listen({ host, port });
startScheduler();
console.log(
  `Orbit is ready at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    stopScheduler();
    await app.close();
    process.exit(0);
  });

if (process.env.ORBIT_DESKTOP_CONFIG_FILE) {
  process.stdin.setEncoding("utf8");
  let input = "";
  process.stdin.on("data", (chunk) => {
    input += chunk;
    if (input.includes("shutdown\n")) {
      stopScheduler();
      void app.close().then(() => process.exit(0));
    }
    if (input.length > 1000) input = "";
  });
  process.stdin.on("end", () => {
    stopScheduler();
    void app.close().then(() => process.exit(0));
  });
}
