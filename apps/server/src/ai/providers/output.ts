import { HttpError } from "../../core.js";
export function withoutReasoning(value: string) {
  return value
    .replace(/<(think(?:ing)?|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(think(?:ing)?|analysis|reasoning)\b[^>]*>[\s\S]*$/gi, "")
    .trim();
}
export function visibleText(message: any) {
  const content =
    typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content
            .filter((p: any) => p.type === "text" || p.type === "output_text")
            .map((p: any) => p.text || "")
            .join("")
        : "";
  return withoutReasoning(content);
}
export function parseStructured(text: string) {
  const clean = withoutReasoning(text)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch {}
  for (let start = 0; start < clean.length; start++) {
    if (clean[start] !== "{" && clean[start] !== "[") continue;
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let end = start; end < clean.length; end++) {
      const c = clean[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') quoted = true;
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(clean.slice(start, end + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  const e = new HttpError(
    422,
    "Модель не вернула завершённый JSON. Проверьте модель в тесте и увеличьте лимит ответа, если он обрезан.",
  );
  e.code = "AI_INVALID_JSON";
  throw e;
}
