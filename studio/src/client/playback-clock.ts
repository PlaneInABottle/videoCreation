export class PlaybackClock {
  private time = 0;
  private readonly listeners = new Set<() => void>();

  readonly getSnapshot = (): number => this.time;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(time: number): void {
    if (!Number.isFinite(time)) return;
    const next = Math.max(0, time);
    if (Math.abs(next - this.time) < 0.0001) return;
    this.time = next;
    for (const listener of this.listeners) listener();
  }
}
