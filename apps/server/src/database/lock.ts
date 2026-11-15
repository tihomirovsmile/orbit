import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
export function assertOffline(directory: string) {
  const file = path.join(directory, ".server-lock");
  if (!existsSync(file)) return;
  const pid = Number(readFileSync(file, "utf8"));
  if (Number.isSafeInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return;
      throw e;
    }
    throw new Error(
      `Orbit process ${pid} is using this data directory. Stop it first.`,
    );
  }
}
export function lockDirectory(directory: string) {
  const file = path.join(directory, ".server-lock");
  assertOffline(directory);
  if (existsSync(file)) unlinkSync(file);
  writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
  return () => {
    if (existsSync(file) && readFileSync(file, "utf8") === String(process.pid))
      unlinkSync(file);
  };
}
