export const NOTIFY_ID = "orbit:system:notify";
export const NOTIFY_SPACE_ID = "notify";
export const notifyIdentity = {
  id: NOTIFY_ID,
  username: "notify",
  displayName: "Notify",
  avatar: "/assets/status/notify.jpg",
  type: "system",
  system: true,
  verified: 0,
  bio: "Важные уведомления об аккаунте, каналах, верификации и решениях поддержки Orbit",
} as const;
export const reasonLabels: Record<string, string> = {
  adult: "Публикация запрещённого 18+ контента",
  fraud: "Мошенничество",
  spam: "Массовая нежелательная рассылка",
  impersonation: "Выдача себя за другого человека или организацию",
  security: "Нарушение безопасности",
  threats: "Угрозы и преследование",
  abuse: "Оскорбления и травля",
  other: "Неопределённо",
};
export const ticketStatusLabels: Record<string, string> = {
  queued: "В очереди",
  active: "На рассмотрении",
  waiting_user: "Нужна информация",
  escalated: "Передано владельцу",
  accepted: "Удовлетворено",
  rejected: "Отклонено",
  closed: "Закрыто",
  withdrawn: "Отозвано",
};
export const closedTicketStatuses = [
  "accepted",
  "rejected",
  "closed",
  "withdrawn",
];
export const assetPaths = {
  user: "/assets/status/user.jpg",
  standard: "/assets/status/channel.jpg",
  orbit: "/assets/status/orbit.jpg",
  freeze: "/assets/status/freeze.jpg",
  removing: "/assets/status/removing.jpg",
  notify: "/assets/status/notify.jpg",
};
export function reservedIdentity(value: string) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[оο]/g, "o")
    .replace(/[іιı]/g, "i")
    .replace(/[тτ]/g, "t")
    .replace(/[уү]/g, "y")
    .replace(/[н]/g, "n")
    .replace(/[^a-z0-9]/g, "");
  return (
    /^notify(?:bot|orbit|system|support|official)?$/.test(normalized) ||
    normalized === NOTIFY_ID.replace(/[^a-z0-9]/g, "")
  );
}
export function calculateAge(date: string, at = new Date()) {
  const d = new Date(date + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(+d) ||
    d.toISOString().slice(0, 10) !== date
  )
    return null;
  let age = at.getUTCFullYear() - d.getUTCFullYear();
  if (
    at.getUTCMonth() < d.getUTCMonth() ||
    (at.getUTCMonth() === d.getUTCMonth() && at.getUTCDate() < d.getUTCDate())
  )
    age--;
  return age;
}
