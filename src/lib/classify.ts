import type { Chess } from 'chess.js';
import type { MoveClass, Phase } from './types';

export const MATE = 30000;

/** True when a centipawn score encodes a forced mate. */
export const isMate = (cp: number) => Math.abs(cp) >= MATE - 1000;

/** Win probability (0-100) for the side whose point of view `cp` is expressed in. */
export function winProb(cp: number): number {
  if (isMate(cp)) return cp > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function classify(loss: number): MoveClass {
  if (loss >= 15) return 'blunder';
  if (loss >= 10) return 'mistake';
  if (loss >= 5) return 'inaccuracy';
  return 'ok';
}

/** Per-move accuracy (0-100) from win-probability loss. */
export function moveAccuracy(loss: number): number {
  const a = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const pieceValue = (p: string) => VALUE[p] ?? 0;

export function phaseOf(chess: Chess): Phase {
  let minor = 0;
  let queens = 0;
  let material = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.type === 'p' || sq.type === 'k') continue;
      minor++;
      material += VALUE[sq.type];
      if (sq.type === 'q') queens++;
    }
  }
  if (minor <= 6 || material <= 20 || (queens === 0 && material <= 26)) return 'endgame';
  if (chess.moveNumber() <= 10) return 'opening';
  return 'middlegame';
}

export function formatEval(cp: number): string {
  if (isMate(cp)) {
    const n = MATE - Math.abs(cp);
    return (cp > 0 ? '+' : '-') + (n ? 'M' + n : '#');
  }
  const v = cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

/** Parses "[%clk 0:02:59.9]" annotations, in ply order. */
export function parseClocks(pgn: string): number[] {
  const out: number[] = [];
  const re = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pgn))) out.push(+m[1] * 3600 + +m[2] * 60 + +m[3]);
  return out;
}

/** "600", "180+2", "1/86400" -> base seconds and increment. */
export function parseTimeControl(tc: string): { base: number; inc: number; daily: boolean } {
  if (tc.includes('/')) return { base: +tc.split('/')[1] || 0, inc: 0, daily: true };
  const [b, i] = tc.split('+');
  return { base: +b || 0, inc: +i || 0, daily: false };
}
