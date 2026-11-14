import { Chess } from 'chess.js';
import type { GameRecord, Result } from './types';

const API = 'https://api.chess.com/pub/player';

interface ApiPlayer {
  username: string;
  rating: number;
  result: string;
}
interface ApiGame {
  url: string;
  pgn?: string;
  end_time: number;
  time_class: string;
  time_control: string;
  rated: boolean;
  rules: string;
  initial_setup?: string;
  white: ApiPlayer;
  black: ApiPlayer;
}

const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 404) throw new Error('Joueur introuvable sur chess.com.');
  if (res.status === 429) throw new Error('chess.com limite les requêtes — réessaie dans une minute.');
  if (!res.ok) throw new Error(`chess.com a répondu ${res.status}.`);
  return res.json() as Promise<T>;
}

function openingName(pgn: string): string {
  const m = /\[ECOUrl "[^"]*\/openings\/([^"]+)"\]/.exec(pgn);
  if (!m) return 'Ouverture inconnue';
  // Keep the family name: drop move suffixes such as "-3.Nf3-Nc6" or "...4.d4".
  const name = m[1].replace(/-\d+\..*$/, '').replace(/\.\.\..*$/, '').replace(/-/g, ' ').trim();
  return name.split(' ').slice(0, 4).join(' ');
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function toRecord(g: ApiGame, user: string): GameRecord | null {
  if (g.rules !== 'chess' || !g.pgn) return null;
  if (g.initial_setup && g.initial_setup !== START) return null;
  const isWhite = g.white.username.toLowerCase() === user;
  const me = isWhite ? g.white : g.black;
  const opp = isWhite ? g.black : g.white;
  const result: Result = me.result === 'win' ? 'win' : DRAWS.has(me.result) ? 'draw' : 'loss';
  return {
    id: g.url,
    url: g.url,
    pgn: g.pgn,
    endTime: g.end_time * 1000,
    timeClass: g.time_class,
    timeControl: g.time_control,
    rated: g.rated,
    userColor: isWhite ? 'w' : 'b',
    userRating: me.rating,
    oppName: opp.username,
    oppRating: opp.rating,
    result,
    resultDetail: result === 'win' ? opp.result : me.result,
    opening: openingName(g.pgn),
  };
}

/** Fetches the player's most recent standard games, newest first. */
export async function fetchRecentGames(username: string, count: number): Promise<GameRecord[]> {
  const user = username.trim().toLowerCase();
  const { archives } = await getJson<{ archives: string[] }>(`${API}/${encodeURIComponent(user)}/games/archives`);
  const out: GameRecord[] = [];
  for (const url of [...archives].reverse()) {
    if (out.length >= count) break;
    const { games } = await getJson<{ games: ApiGame[] }>(url);
    for (const g of [...games].reverse()) {
      const rec = toRecord(g, user);
      if (rec && movesCount(rec.pgn) >= 10) out.push(rec);
      if (out.length >= count) break;
    }
  }
  return out;
}

function movesCount(pgn: string): number {
  try {
    const c = new Chess();
    c.loadPgn(pgn);
    return c.history().length;
  } catch {
    return 0;
  }
}
