import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  requirePersonaCreator,
  requireAiManager,
  HttpError,
  emit,
} from "../core.js";
import { all, one, run, tx, id, now, audit } from "../database/index.js";
import { personaSchema } from "../ai/personality/index.js";
import { generatePersonaDraft } from "../ai/personality/drafts.js";
import { generateAgent, enqueue } from "../ai/simulation/engine.js";
const behavior = z
  .object({
    language: z.enum(["ru", "uk", "en", "it", "es"]).optional(),
    traits: z.record(z.string(), z.number().min(0).max(1)).optional(),
  })
  .optional();
export async function personaRoutes(app: FastifyInstance) {
  app.post("/api/admin/personas/draft", async (req) => {
    requirePersonaCreator(req);
    const b = z
      .object({
        seed: z.string().max(5000),
        locked: z.record(z.string(), z.any()).optional(),
        behavior,
      })
      .parse(req.body);
    return generatePersonaDraft(b);
  });
  app.post("/api/admin/personas", async (req) => {
    const actor = requirePersonaCreator(req),
      b = z
        .object({
          profile: personaSchema,
          avatarId: z.string().nullable().optional(),
          behavior,
          customizationEnabled: z.boolean().default(true),
        })
        .parse(req.body),
      userId = id();
    validateAvatar(actor.user_id, b.avatarId);
    await generateAgent({
      id: userId,
      payload: JSON.stringify({
        manualProfile: b.profile,
        behavior: b.behavior,
        seed: userId,
      }),
    });
    if (b.avatarId !== undefined)
      run(
        "UPDATE users SET avatar=? WHERE id=?",
        b.avatarId ? "/media/" + b.avatarId : null,
        userId,
      );
    run(
      "UPDATE ai_personas SET customization_enabled=? WHERE user_id=?",
      Number(b.customizationEnabled),
      userId,
    );
    audit(actor.user_id, "persona.created", userId, {
      mode: "manual_or_mixed",
    });
    return { id: userId };
  });
  app.get("/api/admin/personas/:id", async (req) => {
    requirePersonaCreator(req);
    const uid = (req.params as any).id,
      u = one(
        "SELECT u.*,p.* FROM users u JOIN ai_personas p ON p.user_id=u.id WHERE u.id=?",
        uid,
      );
    if (!u) throw new HttpError(404, "Личность не найдена");
    return {
      avatar: u.avatar,
      profile: {
        displayName: u.display_name,
        username: u.username,
        bio: u.bio,
        country: u.country,
        birthDate: u.birth_date || undefined,
        biography: u.biography,
        occupation: u.occupation,
        interests: JSON.parse(u.interests),
        goals: JSON.parse(u.goals),
        timezone: JSON.parse(u.schedule).timezone,
        avatarStyle: u.avatar_style,
        additionalLanguages: all(
          "SELECT language,proficiency FROM user_languages WHERE user_id=? AND proficiency!='native'",
          uid,
        ),
      },
      behavior: {
        language: u.language,
        traits: Object.fromEntries(
          Object.entries(JSON.parse(u.traits)).filter(
            ([, v]) => typeof v === "number",
          ),
        ),
      },
      customizationEnabled: !!u.customization_enabled,
      memories: all(
        "SELECT id,kind,content,created_at FROM agent_memories WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        uid,
      ),
      relationships: all(
        "SELECT r.*,u.display_name FROM relationships r JOIN users u ON u.id=r.target_id WHERE r.user_id=?",
        uid,
      ),
      history: all(
        "SELECT actor_type,reason,before_data,after_data,created_at FROM profile_history WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        uid,
      ),
    };
  });
  app.put("/api/admin/personas/:id", async (req) => {
    const actor = requirePersonaCreator(req),
      uid = (req.params as any).id,
      b = z
        .object({
          profile: personaSchema,
          avatarId: z.string().nullable().optional(),
          behavior,
          customizationEnabled: z.boolean().default(true),
          reason: z.string().trim().min(3).max(1000),
        })
        .parse(req.body),
      u = one("SELECT * FROM users WHERE id=? AND type='ai'", uid),
      p = one("SELECT * FROM ai_personas WHERE user_id=?", uid);
    if (!u || !p) throw new HttpError(404, "Личность не найдена");
    validateAvatar(actor.user_id, b.avatarId);
    tx(() => {
      if (b.avatarId !== undefined)
        run(
          "UPDATE users SET avatar=? WHERE id=?",
          b.avatarId ? "/media/" + b.avatarId : null,
          uid,
        );
      run(
        "UPDATE users SET username=?,display_name=?,bio=?,country=?,birth_date=?,language=? WHERE id=?",
        b.profile.username,
        b.profile.displayName,
        b.profile.bio,
        b.profile.country,
        b.profile.birthDate || null,
        b.behavior?.language || u.language,
        uid,
      );
      run(
        "UPDATE ai_personas SET biography=?,occupation=?,interests=?,goals=?,avatar_style=?,traits=?,schedule=?,customization_enabled=? WHERE user_id=?",
        b.profile.biography,
        b.profile.occupation,
        JSON.stringify(b.profile.interests),
        JSON.stringify(b.profile.goals),
        b.profile.avatarStyle,
        JSON.stringify({ ...JSON.parse(p.traits), ...b.behavior?.traits }),
        JSON.stringify({
          ...JSON.parse(p.schedule),
          ...(b.profile.timezone ? { timezone: b.profile.timezone } : {}),
        }),
        Number(b.customizationEnabled),
        uid,
      );
      run(
        "INSERT INTO profile_history VALUES(?,?,?,?,?,?,?,?)",
        id(),
        uid,
        actor.user_id,
        "staff",
        JSON.stringify({
          name: u.display_name,
          avatar: u.avatar,
          bio: u.bio,
          traits: JSON.parse(p.traits),
        }),
        JSON.stringify(b),
        b.reason,
        now(),
      );
      audit(actor.user_id, "persona.updated", uid, { reason: b.reason });
    });
    emit();
    return { ok: true };
  });
}

function validateAvatar(actorId: string, avatarId?: string | null) {
  if (
    avatarId &&
    !one(
      "SELECT 1 FROM media_assets WHERE id=? AND owner_id=? AND mime LIKE 'image/%'",
      avatarId,
      actorId,
    )
  )
    throw new HttpError(400, "Выберите собственное загруженное изображение");
}
