export type SoundKind =
  "message" | "notification" | "sent" | "error" | "success";
// Original synthesized sounds. Optional replacement URLs must refer to local /media assets.
const notes: Record<SoundKind, number[]> = {
  message: [620, 830],
  notification: [520],
  sent: [760],
  error: [290, 230],
  success: [650, 900],
};
export function playSound(kind: SoundKind) {
  const volume = Number(localStorage.getItem("volume") || 0);
  if (volume <= 0) return;
  try {
    const replacement = JSON.parse(localStorage.getItem("soundFiles") || "{}")[
      kind
    ];
    if (
      typeof replacement === "string" &&
      /^\/media\/[a-f0-9-]{36}$/.test(replacement)
    ) {
      const audio = new Audio(replacement);
      audio.volume = volume;
      void audio.play().catch(() => {});
      return;
    }
    const ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(volume * 0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    notes[kind].forEach((n, i) => {
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.frequency.setValueAtTime(n, ctx.currentTime + i * 0.09);
      osc.start(ctx.currentTime + i * 0.09);
      osc.stop(ctx.currentTime + i * 0.09 + 0.13);
    });
    setTimeout(() => void ctx.close(), 500);
  } catch {}
}
