const gates = new Map<
  string,
  {
    active: number;
    waiting: { limit: number; resolve: (release: () => void) => void }[];
  }
>();
export async function providerSlot(id: string, limit: number) {
  const gate = gates.get(id) || { active: 0, waiting: [] };
  gates.set(id, gate);
  const release = () => {
    gate.active--;
    while (gate.waiting.length && gate.active < gate.waiting[0].limit) {
      const next = gate.waiting.shift()!;
      gate.active++;
      next.resolve(release);
    }
  };
  if (gate.active < limit) {
    gate.active++;
    return release;
  }
  return new Promise<() => void>((resolve) =>
    gate.waiting.push({ limit, resolve }),
  );
}
