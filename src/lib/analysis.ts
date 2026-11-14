import { Chess, type Move } from 'chess.js';
import { MATE, classify, isMate, moveAccuracy, parseClocks, parseTimeControl, phaseOf, pieceValue, winProb } from './classify';
import type { Engine, EngineResult } from './engine';
import { newSrs } from './srs';
import type { GameAnalysis, GameRecord, MoveClass, PlyInfo, Puzzle, Tag } from './types';

export const toUci = (m: Pick<Move, 'from' | 'to' | 'promotion'>) => m.from + m.to + (m.promotion ?? '');

/** Converts a UCI line to SAN from a position; stops at the first illegal move. */
export function lineToSan(fen: string, uci: string[], max = 8): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of uci.slice(0, max)) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

/** Evaluation of a position from the side to move, without the engine when the game is over. */
export async function evalPosition(engine: Engine, fen: string, depth: number): Promise<EngineResult> {
  const c = new Chess(fen);
  if (c.isCheckmate()) return { score: -MATE, best: '', pv: [] };
  if (c.isGameOver()) return { score: 0, best: '', pv: [] };
  return engine.analyse(fen, depth);
}

export class Cancelled extends Error {}

export async function analyseGame(
  game: GameRecord,
  engine: Engine,
  depth: number,
  onProgress: (fraction: number) => void,
  cancelled: () => boolean,
): Promise<{ analysis: GameAnalysis; puzzles: Puzzle[] }> {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const moves = chess.history({ verbose: true });
  const fens = [moves[0].before, ...moves.map((m) => m.after)];

  const results: EngineResult[] = [];
  const evalW: number[] = []; // White's point of view
  for (let i = 0; i < fens.length; i++) {
    if (cancelled()) throw new Cancelled();
    const r = await evalPosition(engine, fens[i], depth);
    results.push(r);
    evalW.push(fens[i].split(' ')[1] === 'w' ? r.score : -r.score);
    onProgress((i + 1) / fens.length);
  }

  const clocks = parseClocks(game.pgn);
  const hasClocks = clocks.length === moves.length;
  const tc = parseTimeControl(game.timeControl);
  const sign = game.userColor === 'w' ? 1 : -1;
  const counts: Record<MoveClass, number> = { ok: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  const puzzles: Puzzle[] = [];
  let accSum = 0;
  let userMoves = 0;

  const plies: PlyInfo[] = moves.map((m, i) => {
    const ply: PlyInfo = { san: m.san, uci: toUci(m), color: m.color, evalAfter: evalW[i + 1] };
    if (hasClocks && !tc.daily) {
      ply.clock = clocks[i];
      const prev = i >= 2 ? clocks[i - 2] : tc.base;
      ply.spent = Math.max(0, prev - clocks[i] + tc.inc);
    }
    if (m.color !== game.userColor) return ply;

    const before = evalW[i] * sign;
    const after = evalW[i + 1] * sign;
    const best = results[i].best;
    const loss = ply.uci === best ? 0 : Math.max(0, winProb(before) - winProb(after));
    const pos = new Chess(m.before);
    ply.phase = phaseOf(pos);
    ply.loss = loss;
    ply.cls = classify(loss);
    counts[ply.cls]++;
    accSum += moveAccuracy(loss);
    userMoves++;
    if (ply.cls === 'ok' || !best) return ply;

    let bestMove: Move | null = null;
    try {
      bestMove = pos.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] });
    } catch {
      return ply;
    }
    ply.bestUci = best;
    ply.bestSan = bestMove.san;

    const tags: Tag[] = [];
    const reply = results[i + 1].best;
    let replyCapture = '';
    if (reply) {
      try {
        replyCapture = new Chess(m.after).move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] }).captured ?? '';
      } catch {
        /* ignore */
      }
    }
    if (isMate(before) && before > 0 && !(isMate(after) && after > 0)) tags.push('missed-mate');
    else if (isMate(after) && after < 0 && !(isMate(before) && before < 0)) tags.push('allowed-mate');
    else if (replyCapture && pieceValue(replyCapture) >= 3) tags.push('hung-piece');
    else if (bestMove.captured || bestMove.promotion || /[+#]/.test(bestMove.san)) tags.push('missed-tactic');
    else tags.push('positional');
    if (ply.clock !== undefined && ply.spent !== undefined) {
      if (ply.clock < Math.max(20, tc.base * 0.1)) tags.push('time-pressure');
      else if (ply.spent <= Math.max(2, tc.base * 0.008)) tags.push('too-fast');
    }
    ply.tags = tags;

    if (ply.cls !== 'inaccuracy') {
      puzzles.push({
        id: `${game.id}#${i}`,
        gameId: game.id,
        ply: i,
        fen: m.before,
        color: m.color,
        playedSan: m.san,
        playedUci: ply.uci,
        bestUci: best,
        bestSan: bestMove.san,
        line: lineToSan(m.before, results[i].pv),
        loss,
        cls: ply.cls,
        phase: ply.phase,
        tags,
        evalBest: before,
        evalPlayed: after,
        created: Date.now(),
        srs: newSrs(),
      });
    }
    return ply;
  });

  return {
    analysis: { depth, startEval: evalW[0], plies, accuracy: userMoves ? accSum / userMoves : 0, counts },
    puzzles,
  };
}
