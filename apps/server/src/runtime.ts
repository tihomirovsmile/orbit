import "dotenv/config";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { z } from "zod";
export const runtimeFile = path.resolve(
  process.env.RUNTIME_CONFIG_FILE || ".orbit-runtime.json",
);
export const runtimeSchema = z.object({
  host: z.string().refine((x) => x === "localhost" || isIP(x) > 0),
  port: z.number().int().min(1).max(65535),
  dataDir: z
    .string()
    .min(1)
    .max(1000)
    .refine((x) => !/[\r\n\0]/.test(x)),
  publicOrigin: z.string().url().or(z.literal("")).default(""),
  secureCookie: z.boolean().default(false),
});
export function readRuntime() {
  return existsSync(runtimeFile)
    ? runtimeSchema.parse(JSON.parse(readFileSync(runtimeFile, "utf8")))
    : null;
}
export function writeRuntime(value: unknown) {
  const config = runtimeSchema.parse(value);
  const staged = runtimeFile + ".tmp";
  writeFileSync(staged, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(staged, runtimeFile);
  return config;
}
const config = readRuntime();
if (config) {
  const values = {
    HOST: config.host,
    PORT: String(config.port),
    DATA_DIR: config.dataDir,
    PUBLIC_ORIGIN: config.publicOrigin,
    SECURE_COOKIE: String(config.secureCookie),
  };
  for (const [key, value] of Object.entries(values))
    if (process.env[key] === undefined && value) process.env[key] = value;
}
