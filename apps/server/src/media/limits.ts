import { setting, one } from "../database/index.js";
import { HttpError } from "../core.js";
export const MiB = 1024 ** 2;
export const defaultMediaLimits = {
  photoFile: 3 * MiB,
  photoMessage: 6 * MiB,
  videoFile: 800 * MiB,
  videoMessage: 800 * MiB,
  audioFile: 100 * MiB,
  audioMessage: 100 * MiB,
  documentFile: 25 * MiB,
  mixedMessage: 1024 * MiB,
  attachments: 10,
};
export function mediaLimits() {
  return { ...defaultMediaLimits, ...setting("mediaLimits", {}) };
}
export function category(mime: string) {
  return mime.startsWith("image/")
    ? "photo"
    : mime.startsWith("video/")
      ? "video"
      : mime.startsWith("audio/")
        ? "audio"
        : "document";
}
export function validateAttachments(mediaIds: string[]) {
  const l = mediaLimits();
  if (mediaIds.length > l.attachments)
    throw new HttpError(
      400,
      `В одном сообщении — не более ${l.attachments} файлов`,
    );
  const sums = { photo: 0, video: 0, audio: 0, document: 0 };
  let total = 0;
  for (const mediaId of new Set(mediaIds)) {
    const m = one("SELECT mime,size FROM media_assets WHERE id=?", mediaId);
    if (!m) throw new HttpError(404, "Вложение не найдено");
    const kind = category(m.mime);
    if (m.size > (l as any)[kind + "File"])
      throw new HttpError(
        413,
        `Слишком большой файл: ${kind === "photo" ? "фотография — до 3 МиБ" : kind === "video" ? "видео — до " + l.videoFile / MiB + " МиБ" : kind === "audio" ? "аудио — до " + l.audioFile / MiB + " МиБ" : "документ — до " + l.documentFile / MiB + " МиБ"}`,
      );
    sums[kind] += m.size;
    total += m.size;
  }
  if (sums.photo > l.photoMessage)
    throw new HttpError(
      413,
      "Общий размер фотографий в одном сообщении — до 6 МиБ. Каждая фотография — до 3 МиБ",
    );
  if (sums.video > l.videoMessage)
    throw new HttpError(413, "Суммарный размер видео в сообщении — до 800 МиБ");
  if (sums.audio > l.audioMessage)
    throw new HttpError(413, "Суммарный размер аудио в сообщении — до 100 МиБ");
  if (total > l.mixedMessage)
    throw new HttpError(
      413,
      "Превышен общий предел смешанных вложений сообщения",
    );
  return sums;
}
