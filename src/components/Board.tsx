import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import { Chess } from 'chess.js';
import { useEffect, useRef } from 'react';

export interface Arrow {
  uci: string;
  brush: 'green' | 'red' | 'blue' | 'yellow';
}

interface Props {
  fen: string;
  orientation: 'w' | 'b';
  /** When set, the side to move can play legal moves. */
  onMove?: (from: string, to: string) => void;
  lastMove?: string; // uci
  arrows?: Arrow[];
  /** Change to force the board back to `fen` after a rejected move. */
  nonce?: number;
}

function legalDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    dests.set(m.from, [...(dests.get(m.from) ?? []), m.to]);
  }
  return dests;
}

export function Board({ fen, orientation, onMove, lastMove, arrows, nonce }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    api.current = Chessground(el.current!, {
      coordinates: true,
      animation: { duration: 180 },
      highlight: { lastMove: true, check: true },
      draggable: { showGhost: true },
      movable: { free: false, showDests: true, events: { after: (from, to) => onMoveRef.current?.(from, to) } },
      drawable: { enabled: false },
    });
    return () => api.current?.destroy();
  }, []);

  const interactive = !!onMove;
  const shapes = JSON.stringify(arrows ?? []);
  useEffect(() => {
    const chess = new Chess(fen);
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    api.current?.set({
      fen,
      orientation: orientation === 'w' ? 'white' : 'black',
      turnColor: turn,
      check: chess.inCheck(),
      lastMove: lastMove ? [lastMove.slice(0, 2) as Key, lastMove.slice(2, 4) as Key] : undefined,
      movable: { color: interactive ? turn : undefined, dests: interactive ? legalDests(chess) : new Map() },
    });
    api.current?.setAutoShapes(
      (JSON.parse(shapes) as Arrow[]).map(
        (a): DrawShape => ({ orig: a.uci.slice(0, 2) as Key, dest: (a.uci.slice(2, 4) || undefined) as Key | undefined, brush: a.brush }),
      ),
    );
  }, [fen, orientation, lastMove, interactive, shapes, nonce]);

  return (
    <div className="board">
      <div ref={el} className="board-inner" />
    </div>
  );
}
