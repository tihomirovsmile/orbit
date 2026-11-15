let csrf = "";
import { playSound } from "./sound";
export function setCSRF(value: string) {
  csrf = value;
}
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const form = options.body instanceof FormData;
  const response = await fetch("/api" + url, {
    ...options,
    headers: {
      ...(!form ? { "Content-Type": "application/json" } : {}),
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
  });
  const result = await response
    .json()
    .catch(() => ({ error: response.statusText }));
  if (!response.ok) {
    playSound("error");
    throw new Error(result.error || response.statusText);
  }
  return result;
}
export const post = <T = any>(url: string, body: unknown = {}) =>
  api<T>(url, { method: "POST", body: JSON.stringify(body) });
export const patch = <T = any>(url: string, body: unknown) =>
  api<T>(url, { method: "PATCH", body: JSON.stringify(body) });
export const put = <T = any>(url: string, body: unknown) =>
  api<T>(url, { method: "PUT", body: JSON.stringify(body) });
