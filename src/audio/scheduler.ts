export const TICK_MS = 25;
export const LOOKAHEAD = 0.15;
export const MAX_LOOKAHEAD = 1.5;
export const LOOKAHEAD_SLACK = 1.5;

export interface SchedulerHost {
  now(): number;
  due(until: number, now: number): void;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  running(): boolean;
}

export function lookaheadFor(gap: number): number {
  if (!Number.isFinite(gap) || gap <= 0) return LOOKAHEAD;
  return Math.min(MAX_LOOKAHEAD, Math.max(LOOKAHEAD, gap * LOOKAHEAD_SLACK));
}

export function createScheduler(host: SchedulerHost): Scheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let last = Number.NaN;

  const tick = (): void => {
    try {
      const now = host.now();
      if (!Number.isFinite(now)) return;
      const gap = now - last;
      last = now;
      host.due(now + lookaheadFor(gap), now);
    } catch {
      return;
    }
  };

  return {
    start(): void {
      if (timer !== null) return;
      last = Number.NaN;
      tick();
      timer = setInterval(tick, TICK_MS);
    },
    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    running(): boolean {
      return timer !== null;
    },
  };
}
