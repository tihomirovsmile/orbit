import type { FastifyInstance, FastifyRequest } from "fastify";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createHash } from "node:crypto";
import { id, now, run, one, dataDir } from "../database/index.js";
import { requireUser, HttpError } from "../core.js";
import { category, mediaLimits, MiB } from "./limits.js";
import { ticketAccess } from "../notify/tickets.js";
export function sniff(data: Buffer, declared = "") {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return "image/jpeg";
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString())) return "image/gif";
  if (
    data.subarray(0, 4).toString() === "RIFF" &&
    data.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (
    data.subarray(0, 4).toString() === "RIFF" &&
    data.subarray(8, 12).toString() === "WAVE"
  )
    return "audio/wav";
  if (
    data.subarray(0, 3).toString() === "ID3" ||
    (data[0] === 255 && (data[1] & 224) === 224)
  )
    return "audio/mpeg";
  if (data.subarray(0, 4).toString() === "OggS") return "audio/ogg";
  if (data.subarray(4, 8).toString() === "ftyp")
    return declared === "video/quicktime"
      ? "video/quicktime"
      : declared === "audio/mp4"
        ? "audio/mp4"
        : "video/mp4";
  if (data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
    return declared === "audio/webm" ? "audio/webm" : "video/webm";
  if (data.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    [
      [3, 4],
      [5, 6],
      [7, 8],
    ].some((p) => data[2] === p[0] && data[3] === p[1])
  )
    return [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(declared)
      ? declared
      : "application/zip";
  if (declared === "text/plain" && data.length && !data.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(data, { stream: true });
      return "text/plain";
    } catch {}
  }
  return null;
}
async function upload(req: FastifyRequest, support = false) {
  const s = requireUser(req, support),
    file = await req.file();
  if (!file) throw new HttpError(400, "Файл не выбран");
  const assetId = id(),
    filename = assetId + ".bin",
    destination = path.join(dataDir, "uploads", filename),
    hash = createHash("sha256");
  let size = 0,
    mime = "",
    prefix = Buffer.alloc(0),
    checked = false;
  const aliases: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-wav": "audio/wav",
    "application/x-zip-compressed": "application/zip",
    "audio/opus": "audio/ogg",
  };
  const declared = aliases[file.mimetype] || file.mimetype,
    l = mediaLimits();
  const inspect = () => {
    if (checked) return;
    checked = true;
    const detected = sniff(prefix, declared);
    if (!detected || detected !== declared)
      throw new HttpError(
        400,
        "Формат файла не соответствует содержимому. Поддерживаются изображения, видео MP4/WebM, аудио, PDF, TXT, ZIP и документы Office.",
      );
    mime = detected;
  };
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        size += chunk.length;
        if (prefix.length < 64)
          prefix = Buffer.concat([
            prefix,
            chunk.subarray(0, 64 - prefix.length),
          ]);
        if (prefix.length >= 12 && !checked) inspect();
        const kind = category(mime || declared),
          limit = (l as any)[kind + "File"] || l.documentFile;
        if (size > limit)
          throw new HttpError(
            413,
            kind === "photo"
              ? "Каждая фотография — до 3 МиБ"
              : `Файл превышает разрешённые ${Math.round(limit / MiB)} МиБ`,
          );
        hash.update(chunk);
        callback(null, chunk);
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        inspect();
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  try {
    await pipeline(
      file.file,
      guard,
      createWriteStream(destination, { flags: "wx" }),
    );
    if (file.file.truncated)
      throw new HttpError(413, "Превышен максимальный размер файла");
    const digest = hash.digest("hex");
    run(
      "INSERT INTO media_assets(id,owner_id,filename,original_name,mime,size,source,license,created_at,scope,sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      assetId,
      s.user_id,
      filename,
      path.basename(file.filename).slice(0, 150),
      mime,
      size,
      "upload",
      "user-supplied",
      now(),
      support ? "support" : "chat",
      digest,
    );
    return {
      id: assetId,
      url: "/media/" + assetId,
      name: file.filename,
      mime,
      size,
      sha256: digest,
    };
  } catch (error) {
    await unlink(destination).catch(() => {});
    throw error;
  }
}
export async function mediaRoutes(app: FastifyInstance) {
  app.post(
    "/api/media",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    (req) => upload(req),
  );
  app.post(
    "/api/notify/media",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    (req) => upload(req, true),
  );
  app.get("/api/media/limits", async (req) => {
    requireUser(req);
    return mediaLimits();
  });
  app.get("/media/:id", async (req, reply) => {
    const s = requireUser(req, true),
      m = one("SELECT * FROM media_assets WHERE id=?", (req.params as any).id);
    if (!m) throw new HttpError(404, "Файл не найден");
    let supportAccess = false;
    const linked = one(
      "SELECT t.id,t.user_id,t.assigned_to FROM ticket_media tm JOIN support_tickets t ON t.id=tm.ticket_id WHERE tm.media_id=? AND (t.user_id=? OR t.assigned_to=? OR ?='OWNER') LIMIT 1",
      m.id,
      s.user_id,
      s.user_id,
      s.role,
    );
    if (linked) {
      try {
        ticketAccess(s.user_id, linked.id, linked.user_id !== s.user_id);
        supportAccess = true;
      } catch {}
    }
    if (
      ["banned", "deletion_pending"].includes(s.status) &&
      !(supportAccess || (m.scope === "support" && m.owner_id === s.user_id))
    )
      throw new HttpError(
        403,
        "В ограниченном режиме доступны только файлы ваших обращений",
        "ACCOUNT_LIMITED",
      );
    let allowed = supportAccess || m.owner_id === s.user_id;
    if (!allowed && !["banned", "deletion_pending"].includes(s.status))
      allowed =
        !!one(
          "SELECT 1 FROM users WHERE avatar=? AND status='active'",
          "/media/" + m.id,
        ) ||
        !!one(
          "SELECT 1 FROM spaces sp WHERE avatar=? AND (visibility='public' OR EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=sp.id AND sm.user_id=?))",
          "/media/" + m.id,
          s.user_id,
        ) ||
        !!one(
          "SELECT 1 FROM message_media mm JOIN messages msg ON msg.id=mm.message_id JOIN spaces sp ON sp.id=msg.space_id WHERE mm.media_id=? AND msg.deleted_at IS NULL AND sp.frozen=0 AND sp.delete_at IS NULL AND (sp.visibility='public' OR EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=sp.id AND sm.user_id=?))",
          m.id,
          s.user_id,
        );
    if (!allowed) throw new HttpError(403, "Нет доступа к файлу");
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .header("Accept-Ranges", "bytes")
      .header(
        "Content-Disposition",
        `${/^(image|video|audio)\//.test(m.mime) ? "inline" : "attachment"}; filename="${m.id}"; filename*=UTF-8''${encodeURIComponent(m.original_name)}`,
      );
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match)
        return reply
          .code(416)
          .header("Content-Range", `bytes */${m.size}`)
          .send();
      let start = match[1]
          ? Number(match[1])
          : Math.max(0, m.size - Number(match[2])),
        end = match[1]
          ? match[2]
            ? Number(match[2])
            : m.size - 1
          : m.size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= m.size ||
        end < start
      ) {
        return reply
          .code(416)
          .header("Content-Range", `bytes */${m.size}`)
          .send();
      }
      end = Math.min(end, m.size - 1);
      return reply
        .code(206)
        .header("Content-Range", `bytes ${start}-${end}/${m.size}`)
        .header("Content-Length", end - start + 1)
        .type(m.mime)
        .send(
          createReadStream(path.join(dataDir, "uploads", m.filename), {
            start,
            end,
          }),
        );
    }
    return reply
      .header("Content-Length", m.size)
      .type(m.mime)
      .send(createReadStream(path.join(dataDir, "uploads", m.filename)));
  });
}
