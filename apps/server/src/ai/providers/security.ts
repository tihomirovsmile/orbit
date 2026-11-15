import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { dataDir } from "../../database/index.js";
import { HttpError } from "../../core.js";
const keyPath = path.join(dataDir, ".encryption-key");
if (!process.env.ENCRYPTION_KEY && !existsSync(keyPath))
  writeFileSync(keyPath, randomBytes(32).toString("hex"), {
    mode: 0o600,
    flag: "wx",
  });
const key = Buffer.from(
  process.env.ENCRYPTION_KEY || readFileSync(keyPath, "utf8").trim(),
  "hex",
);
if (key.length !== 32)
  throw new Error("ENCRYPTION_KEY must be 64 hex characters");
export function encrypt(text: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    iv,
    cipher.update(text, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
export function decrypt(text: string) {
  const data = Buffer.from(text, "base64"),
    cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([
    cipher.update(data.subarray(12, -16)),
    cipher.final(),
  ]).toString("utf8");
}
export function privateIP(ip: string) {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v.includes(":"))
    return (
      v === "::" ||
      v === "::1" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe8") ||
      v.startsWith("fe9") ||
      v.startsWith("fea") ||
      v.startsWith("feb") ||
      v.startsWith("ff") ||
      v.startsWith("::ffff:")
    );
  const p = v.split(".").map(Number);
  return (
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}
export async function validateEndpoint(base: string, trustedLocal: boolean) {
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new HttpError(400, "Некорректный адрес провайдера");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (!addresses.length) throw new HttpError(400, "Адрес не разрешён");
  if (
    !trustedLocal &&
    (url.protocol !== "https:" || addresses.some((x) => privateIP(x.address)))
  )
    throw new HttpError(
      400,
      "Внутренний адрес или HTTP требует явного доверия владельца",
    );
  return url.toString().replace(/\/$/, "");
}
