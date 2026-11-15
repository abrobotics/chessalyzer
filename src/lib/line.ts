import { Chess, type Move } from 'chess.js';
import { pieceValue } from './classify';
import type { Color } from './types';

export interface Frame {
  fen: string; // position after the move
  uci: string;
  san: string;
  mine: boolean;
  caption: string;
}

const PIECE: Record<string, string> = {
  p: 'le pion',
  n: 'le cavalier',
  b: 'le fou',
  r: 'la tour',
  q: 'la dame',
  k: 'le roi',
};
const PROMO: Record<string, string> = { q: 'une dame', r: 'une tour', b: 'un fou', n: 'un cavalier' };

/** Plain-language description of a move, from the trainee's point of view. */
function describe(m: Move, mine: boolean): string {
  const who = mine ? 'Tu' : 'L’adversaire';
  let text: string;
  if (m.san.startsWith('O-O')) text = `${who} ${mine ? 'roques' : 'roque'}`;
  else if (m.captured) text = `${who} ${mine ? 'prends' : 'prend'} ${PIECE[m.captured]} en ${m.to}`;
  else text = `${who} ${mine ? 'joues' : 'joue'} ${PIECE[m.piece]} en ${m.to}`;
  if (m.promotion) text += ` et ${mine ? 'obtiens' : 'obtient'} ${PROMO[m.promotion]}`;
  if (m.san.endsWith('#')) text += ' — échec et mat !';
  else if (m.san.endsWith('+')) text += ' avec échec';
  return text;
}

/** Replays a SAN line from a position; stops at the first illegal move. */
export function buildFrames(fen: string, sans: string[], me: Color): Frame[] {
  const c = new Chess(fen);
  const out: Frame[] = [];
  for (const san of sans) {
    let m: Move;
    try {
      m = c.move(san);
    } catch {
      break;
    }
    const mine = m.color === me;
    out.push({ fen: c.fen(), uci: m.from + m.to + (m.promotion ?? ''), san: m.san, mine, caption: describe(m, mine) });
  }
  return out;
}

function balance(fen: string, me: Color): number {
  let total = 0;
  for (const row of new Chess(fen).board()) {
    for (const sq of row) if (sq) total += pieceValue(sq.type) * (sq.color === me ? 1 : -1);
  }
  return total;
}

const AMOUNT: Record<number, string> = { 1: 'un pion', 2: 'deux pions', 3: 'une pièce', 5: 'une tour', 9: 'une dame' };

/** One-sentence material outcome of a line for the trainee. */
export function summarise(startFen: string, frames: Frame[], me: Color): string {
  const last = frames[frames.length - 1];
  if (!last) return '';
  if (last.san.endsWith('#')) return last.mine ? 'Tu mets mat.' : 'Tu te fais mater.';
  const delta = balance(last.fen, me) - balance(startFen, me);
  if (delta === 0) return 'Matériel égal : la différence est positionnelle.';
  const amount = AMOUNT[Math.abs(delta)] ?? `${Math.abs(delta)} points de matériel`;
  return delta > 0 ? `Tu gagnes ${amount}.` : `Tu perds ${amount}.`;
}
