export type Color = 'w' | 'b';
export type MoveClass = 'ok' | 'inaccuracy' | 'mistake' | 'blunder';
export type Phase = 'opening' | 'middlegame' | 'endgame';
export type Tag =
  | 'missed-mate'
  | 'allowed-mate'
  | 'hung-piece'
  | 'missed-tactic'
  | 'positional'
  | 'time-pressure'
  | 'too-fast';
export type Result = 'win' | 'loss' | 'draw';

export interface GameRecord {
  id: string;
  url: string;
  pgn: string;
  endTime: number; // ms epoch
  timeClass: string;
  timeControl: string;
  rated: boolean;
  userColor: Color;
  userRating: number;
  oppName: string;
  oppRating: number;
  result: Result;
  resultDetail: string;
  opening: string;
  analysis?: GameAnalysis;
}

/** One entry per ply of the game. Error details only exist on the user's moves. */
export interface PlyInfo {
  san: string;
  uci: string;
  color: Color;
  /** Engine evaluation after this move, centipawns, White's point of view. */
  evalAfter: number;
  clock?: number; // seconds left after the move
  spent?: number; // seconds spent on the move
  // user's moves only
  phase?: Phase;
  loss?: number; // win-probability points lost (0-100)
  cls?: MoveClass;
  bestUci?: string;
  bestSan?: string;
  tags?: Tag[];
}

export interface GameAnalysis {
  depth: number;
  startEval: number;
  plies: PlyInfo[];
  accuracy: number;
  counts: Record<MoveClass, number>;
}

export interface Srs {
  box: number;
  due: number; // ms epoch
  attempts: number;
  successes: number;
  last?: number;
}

export interface Puzzle {
  id: string;
  gameId: string;
  ply: number; // index of the user's move in the game
  fen: string;
  color: Color;
  playedSan: string;
  playedUci: string;
  bestUci: string;
  bestSan: string;
  line: string[]; // best line in SAN
  /** The played move followed by the engine's punishment, in SAN. Filled lazily for older puzzles. */
  refutation?: string[];
  loss: number;
  cls: MoveClass;
  phase: Phase;
  tags: Tag[];
  evalBest: number; // cp, user's POV, before the move
  evalPlayed: number; // cp, user's POV, after the played move
  created: number;
  srs: Srs;
}
