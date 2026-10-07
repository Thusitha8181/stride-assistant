export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });

export const DAY_MS = 24 * 60 * 60 * 1000;

export const daysAgo = (clock: Clock, days: number) => new Date(clock.now().getTime() - days * DAY_MS);

export const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);
