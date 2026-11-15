import { parsePersona, parseJSON, personaSchema } from "./index.js";
import { complete } from "../providers/service.js";
import { HttpError } from "../../core.js";
export async function generatePersonaDraft(options: {
  seed: string;
  behavior?: any;
  locked?: Record<string, any>;
  configuration?: { providerId: string; modelId: string };
}) {
  const locked = Object.fromEntries(
    Object.entries(options.locked || {}).filter(
      ([, v]) =>
        v !== undefined &&
        v !== null &&
        v !== "" &&
        (!Array.isArray(v) || v.length > 0),
    ),
  );
  const result = await complete(
    "personality",
    [
      {
        role: "system",
        content:
          "Create a fictional adult internet user for an experimental social simulation. Return ONLY JSON with displayName, username (ASCII letters/digits/underscore/dot, 3-32, not notify), birthDate (YYYY-MM-DD, adult), bio, country, timezone (valid IANA), occupation, biography, interests (array), goals (array), avatarStyle (abstract|landscape|animal|drawing|minimal|none), additionalLanguages [{language:ru|uk|en|it|es,proficiency:native|fluent|conversational|basic|weak}]. Keep explicit locked fields exactly unchanged. Fill gaps only. Do not invent private facts about real people or claim that a simulation is their authenticated account. Do not prepend a fan-account suffix; automation is disclosed in profile details. No hidden thoughts in final JSON.",
      },
      {
        role: "user",
        content: JSON.stringify({
          seed: options.seed,
          behavior: options.behavior,
          locked,
        }),
      },
    ],
    null,
    options.configuration,
  );
  let raw: any;
  try {
    raw = parseJSON(result.text);
  } catch {
    raw = null;
  }
  try {
    return {
      profile: personaSchema.parse({ ...raw, ...locked }),
      usage: result.usage,
      repairs: 0,
      warnings: raw
        ? Object.keys({
            bio: "",
            country: "",
            occupation: "",
            biography: "",
            goals: [],
            interests: [],
          }).filter((k) => raw[k] === undefined)
        : [],
    };
  } catch {}
  const repaired = await complete(
    "personality",
    [
      {
        role: "system",
        content:
          "Repair one incomplete JSON profile. Return ONLY a complete JSON object: displayName, username (ASCII 3-32, not notify), bio, country, occupation, biography, interests (array), goals (array), avatarStyle, additionalLanguages. Preserve every valid explicit locked field and every valid existing value. Fill only missing or invalid mandatory fields. Do not invent real-person private facts.",
      },
      {
        role: "user",
        content: JSON.stringify({
          locked,
          existing: raw || result.text.slice(0, 10000),
        }),
      },
    ],
    null,
    options.configuration,
  );
  let profile;
  try {
    profile = personaSchema.parse({ ...parseJSON(repaired.text), ...locked });
  } catch {
    throw new HttpError(
      422,
      "Модель не смогла дополнить обязательные имя и ник после одной попытки. Заполните их вручную в смешанном редакторе либо выберите другую модель.",
      "AI_PROFILE_SCHEMA",
    );
  }
  return {
    profile,
    usage: {
      input: result.usage.input + repaired.usage.input,
      output: result.usage.output + repaired.usage.output,
      cost: result.usage.cost + repaired.usage.cost,
    },
    repairs: 1,
    warnings: ["Обязательные поля дополнены одним дополнительным запросом"],
  };
}
