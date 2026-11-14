import type { Srs } from './types';

const DAY = 86_400_000;
/** Leitner boxes: days to wait before the next review. */
export const INTERVALS = [0, 1, 3, 7, 16, 35];
export const MASTERED_BOX = 4;

export const newSrs = (): Srs => ({ box: 0, due: 0, attempts: 0, successes: 0 });

export function review(srs: Srs, success: boolean, now = Date.now()): Srs {
  const box = success ? Math.min(INTERVALS.length - 1, srs.box + 1) : 0;
  return {
    box,
    due: success ? now + INTERVALS[box] * DAY : now + 10 * 60_000,
    attempts: srs.attempts + 1,
    successes: srs.successes + (success ? 1 : 0),
    last: now,
  };
}
