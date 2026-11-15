import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { all, one, run, now, id, dataDir } from "../database/index.js";
import { requireUser, requireOwner, HttpError } from "../core.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
export function fallbackAvatar(seed: string, interests: string[] = []) {
  const digest = createHash("sha256")
    .update(seed + interests.join(","))
    .digest();
  const colors = [
    "#dce5cd",
    "#e8d6be",
    "#cedfe2",
    "#dfd5e4",
    "#eee1b7",
    "#c5dfd0",
  ];
  const bg = colors[digest[0] % colors.length],
    fg = ["#758d63", "#b88f65", "#75969a", "#9a82a8", "#bca05e", "#6c9c84"][
      digest[0] % colors.length
    ];
  const cx = 35 + (digest[1] % 30),
    cy = 30 + (digest[2] % 40);
  const motif = interests.join(" ").match(/photo|nature|land|пейз|природ/i)
    ? `<path d="M0 105L40 52L75 88L102 40L160 105V160H0Z" fill="${fg}"/><circle cx="118" cy="30" r="13" fill="#faf3d1"/>`
    : interests.join(" ").match(/music|муз|anime|game|drawing/i)
      ? `<rect x="35" y="35" width="90" height="90" rx="${digest[3] % 30}" fill="${fg}" transform="rotate(${digest[4] % 70} 80 80)"/><circle cx="80" cy="80" r="18" fill="${bg}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="42" fill="${fg}" opacity=".8"/><circle cx="112" cy="109" r="53" fill="${fg}" opacity=".4"/><ellipse cx="80" cy="80" rx="65" ry="28" transform="rotate(-35 80 80)" stroke="#fff" stroke-opacity=".6" fill="none"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="${bg}"/>${motif}</svg>`;
}
export function assignAvatar(userId: string, version = "initial") {
  const p = one("SELECT * FROM ai_personas WHERE user_id=?", userId);
  if (!p) return false;
  if (p.avatar_style === "none") return false;
  const interests = JSON.parse(p.interests) as string[];
  const assets = all(
    "SELECT * FROM media_assets WHERE mime LIKE 'image/%' AND license IN ('CC0','CC BY','CC BY-SA')",
  );
  const suitable = assets.filter((a) =>
    interests.some((i) => a.tags.toLowerCase().includes(i.toLowerCase())),
  );
  const unused = suitable.find(
    (a) => !one("SELECT 1 FROM users WHERE avatar=?", `/media/${a.id}`),
  );
  const assetUrl = unused
    ? `/media/${unused.id}`
    : `/api/avatars/${userId}?v=${encodeURIComponent(version)}`;
  run(
    "INSERT INTO avatar_history VALUES(?,?,?,?,?)",
    id(),
    userId,
    assetUrl,
    p.seed + ":" + version,
    now(),
  );
  run("UPDATE users SET avatar=? WHERE id=?", assetUrl, userId);
  return true;
}
export async function avatarRoutes(app: FastifyInstance) {
  app.get("/api/avatars/:id", async (req, reply) => {
    requireUser(req, true);
    const p = one(
      "SELECT seed,interests FROM ai_personas WHERE user_id=?",
      (req.params as any).id,
    );
    if (
      !p ||
      ["banned", "deletion_pending"].includes(
        one("SELECT status FROM users WHERE id=?", (req.params as any).id)
          ?.status,
      )
    )
      throw new HttpError(404, "Аватар недоступен");
    return reply
      .type("image/svg+xml")
      .header("Cache-Control", "private, no-store")
      .send(
        fallbackAvatar(
          one(
            "SELECT seed FROM avatar_history WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
            (req.params as any).id,
          )?.seed || p.seed,
          JSON.parse(p.interests),
        ),
      );
  });
  app.get("/api/admin/media-library", async (req) => {
    requireOwner(req);
    return all(
      "SELECT id,original_name name,mime,source,license,attribution,tags FROM media_assets WHERE license IN ('CC0','CC BY','CC BY-SA')",
    );
  });
  app.post("/api/admin/media-library/:id", async (req) => {
    requireOwner(req);
    const b = req.body as any;
    if (
      !["CC0", "CC BY", "CC BY-SA"].includes(b.license) ||
      typeof b.tags !== "string" ||
      b.tags.length > 500 ||
      typeof b.attribution !== "string" ||
      b.attribution.length > 1000
    )
      throw new HttpError(
        400,
        "Укажите проверенную лицензию, теги и атрибуцию",
      );
    run(
      "UPDATE media_assets SET license=?,tags=?,attribution=? WHERE id=?",
      b.license,
      b.tags,
      b.attribution,
      (req.params as any).id,
    );
    return { ok: true };
  });
  // Commons search is opt-in, uses the public API, and never scrapes profiles or imports real-person portraits.
  app.get("/api/admin/media-search", async (req) => {
    requireOwner(req);
    const query = String((req.query as any).q || "").slice(0, 100);
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: `${query} -portrait -people -person`,
      gsrnamespace: "6",
      gsrlimit: "8",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "256",
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      headers: {
        "User-Agent": "Orbit/3.0",
      },
    });
    if (!response.ok) throw new HttpError(502, "Wikimedia API недоступно");
    const result: any = await response.json();
    return Object.values(result.query?.pages || {})
      .map((p: any) => {
        const info = p.imageinfo?.[0],
          meta = info?.extmetadata;
        return {
          title: p.title,
          url: info?.thumburl,
          source: info?.descriptionurl,
          license: meta?.LicenseShortName?.value,
          attribution: meta?.Artist?.value?.replace(/<[^>]*>/g, ""),
        };
      })
      .filter(
        (x) =>
          x.url &&
          [
            "CC0",
            "CC BY 4.0",
            "CC BY-SA 4.0",
            "CC BY-SA 3.0",
            "CC BY 3.0",
            "Public domain",
          ].includes(x.license),
      );
  });
  app.post("/api/admin/media-import", async (req) => {
    const s = requireOwner(req);
    const b = req.body as any;
    const url = new URL(String(b.url));
    if (
      url.protocol !== "https:" ||
      url.hostname !== "upload.wikimedia.org" ||
      url.username ||
      url.password
    )
      throw new HttpError(400, "Разрешены только изображения Wikimedia");
    if (
      ![
        "CC0",
        "CC BY 4.0",
        "CC BY-SA 4.0",
        "CC BY-SA 3.0",
        "CC BY 3.0",
        "Public domain",
      ].includes(b.license) ||
      typeof b.attribution !== "string" ||
      typeof b.source !== "string"
    )
      throw new HttpError(
        400,
        "Нужны лицензия и атрибуция из результатов поиска",
      );
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    const mime = response.headers.get("content-type")?.split(";")[0];
    if (
      !response.ok ||
      !["image/jpeg", "image/png", "image/webp"].includes(mime || "")
    )
      throw new HttpError(400, "Недопустимый формат");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body as any) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024)
        throw new HttpError(400, "Изображение слишком большое");
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks),
      mediaId = id();
    await writeFile(path.join(dataDir, "uploads", mediaId + ".bin"), data);
    run(
      "INSERT INTO media_assets VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      mediaId,
      s.user_id,
      mediaId + ".bin",
      String(b.title || "Commons asset").slice(0, 100),
      mime,
      size,
      b.source,
      b.license.startsWith("CC BY-SA")
        ? "CC BY-SA"
        : b.license.startsWith("CC BY")
          ? "CC BY"
          : "CC0",
      b.attribution.slice(0, 1000),
      String(b.tags || "").slice(0, 500),
      now(),
    );
    return { id: mediaId };
  });
}
