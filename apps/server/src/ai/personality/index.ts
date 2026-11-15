import { createHash } from "node:crypto";
import { z } from "zod";
import { languages } from "../../../../../packages/shared/types.js";
import { parseStructured } from "../providers/output.js";
import { HttpError } from "../../core.js";
import {
  reservedIdentity,
  calculateAge,
} from "../../../../../packages/shared/policy.js";
export function seeded(seed: string) {
  let state = createHash("sha256").update(seed).digest().readUInt32LE();
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function behavioralProfile(seed: string) {
  const r = seeded(seed);
  const language = languages[Math.floor(r() * 5)],
    sociability = r(),
    energy = r();
  return {
    language,
    traits: {
      ageCategory: ["18–24", "25–34", "35–49", "50+"][Math.floor(r() * 4)],
      sociability,
      openness: r(),
      argumentative: r() ** 2,
      humor: r(),
      sensitivity: r(),
      patience: r(),
      contentDrive: r() ** 2,
      energy,
      initiative: r(),
      chaos: r(),
    },
    writing: {
      averageLength: 12 + Math.floor(r() ** 2 * 180),
      lowercase: r(),
      emoji: r() ** 2,
      slang: r(),
      punctuation: r(),
      typos: r() * 0.12,
      multiMessage: r(),
    },
    schedule: {
      offset: Math.floor(r() * 25) - 12,
      wake: 6 + Math.floor(r() * 6),
      sleep: 21 + Math.floor(r() * 7),
      weekendMultiplier: 0.6 + r(),
      absenceProbability: r() * 0.25,
    },
    emotion: { calm: 0.7, fatigue: 0.2, joy: 0.4, socialEnergy: energy },
  };
}
export const personaSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((v) => !reservedIdentity(v), "Имя Notify зарезервировано системой"),
  username: z
    .string()
    .regex(/^[a-zA-Z0-9_.]{3,32}$/)
    .refine((v) => !reservedIdentity(v), "Имя Notify зарезервировано системой"),
  bio: z.string().max(600).default(""),
  country: z.string().max(80).default(""),
  birthDate: z
    .string()
    .refine((v) => {
      const age = calculateAge(v);
      return age !== null && age >= 18 && age <= 110;
    }, "Дата рождения должна соответствовать взрослой личности (18–110 лет)")
    .optional(),
  timezone: z
    .string()
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
  occupation: z.string().max(150).default(""),
  biography: z.string().max(1600).default(""),
  interests: z
    .array(z.string().max(60))
    .min(1)
    .max(12)
    .default(["общение", "повседневность"]),
  goals: z.array(z.string().max(150)).max(8).default([]),
  avatarStyle: z
    .enum(["abstract", "landscape", "animal", "drawing", "minimal", "none"])
    .default("abstract"),
  additionalLanguages: z
    .array(
      z.object({
        language: z.enum(languages),
        proficiency: z.enum([
          "native",
          "fluent",
          "conversational",
          "basic",
          "weak",
        ]),
      }),
    )
    .max(4)
    .default([]),
});
export function parseJSON(text: string) {
  return parseStructured(text);
}
export function parsePersona(text: string) {
  const result = personaSchema.safeParse(parseJSON(text));
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((i) => i.path.join("."))),
    ]
      .slice(0, 6)
      .join(", ");
    throw new HttpError(
      422,
      `Модель вернула неполный профиль (${fields}). На шаге «Модель» увеличьте лимит ответа или выберите другую модель, затем выполните проверку генерации.`,
      "AI_PROFILE_SCHEMA",
    );
  }
  return result.data;
}
const syllables = [
  "va",
  "ren",
  "mo",
  "ki",
  "li",
  "na",
  "so",
  "mar",
  "el",
  "vi",
  "no",
  "da",
  "shi",
  "lo",
  "an",
  "ru",
  "te",
  "zen",
  "ka",
  "pe",
  "lu",
  "mi",
  "ya",
  "ro",
  "fi",
  "os",
  "ha",
  "ce",
  "to",
  "bel",
];
export function syntheticPersona(seed: string) {
  const r = seeded(seed + "fixture"),
    pick = () => syllables[Math.floor(r() * syllables.length)];
  const handle = Array.from({ length: 2 + Math.floor(r() * 3) }, pick).join("");
  const p = behavioralProfile(seed);
  const topics = [
    "photography",
    "anime",
    "music",
    "games",
    "drawing",
    "technology",
    "books",
    "cooking",
    "cinema",
    "running",
    "gardening",
    "architecture",
  ];
  return {
    displayName: handle.slice(0, Math.max(3, handle.length - 2)),
    username:
      handle +
      "_" +
      createHash("sha256").update(seed).digest("hex").slice(0, 4),
    bio: "[TEST] Synthetic persona",
    country: "Synthetic",
    occupation: "Test character",
    biography: "Explicitly synthetic development fixture; not LLM-generated.",
    interests: [
      topics[Math.floor(r() * topics.length)],
      topics[Math.floor(r() * topics.length)],
    ],
    goals: ["Explore the test network"],
    avatarStyle: "abstract" as const,
    additionalLanguages: [],
    ...p,
  };
}
export function tooSimilar(text: string, previous: string[]) {
  if (text.length < 30) return false;
  const grams = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .split(/\s+/)
        .map((_, i, a) => a.slice(i, i + 3).join(" ")),
    );
  const a = grams(text);
  return previous.some((p) => {
    const b = grams(p);
    let common = 0;
    for (const word of a) if (b.has(word)) common++;
    return common / Math.max(1, a.size + b.size - common) > 0.72;
  });
}
