import { clear, entries, set, setMany } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { Cancelled, analyseGame } from './analysis';
import { fetchRecentGames } from './chesscom';
import { Engine } from './engine';
import type { GameRecord, Puzzle } from './types';

export interface Settings {
  username: string;
  depth: number;
  count: number;
}

export interface State {
  loaded: boolean;
  settings: Settings;
  games: GameRecord[]; // newest first
  puzzles: Puzzle[];
  syncing: boolean;
  error: string;
  analysing: boolean;
  /** Fraction of the game currently being analysed. */
  progress: number;
  currentGame: string;
}

let state: State = {
  loaded: false,
  settings: { username: '', depth: 12, count: 30 },
  games: [],
  puzzles: [],
  syncing: false,
  error: '',
  analysing: false,
  progress: 0,
  currentGame: '',
};

const listeners = new Set<() => void>();
function update(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useStore(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const byDate = (a: GameRecord, b: GameRecord) => b.endTime - a.endTime;

export async function init() {
  const games: GameRecord[] = [];
  const puzzles: Puzzle[] = [];
  let settings = state.settings;
  try {
    for (const [k, v] of await entries<string, unknown>()) {
      if (k.startsWith('g:')) games.push(v as GameRecord);
      else if (k.startsWith('p:')) puzzles.push(v as Puzzle);
      else if (k === 'settings') settings = { ...settings, ...(v as Settings) };
    }
  } catch {
    /* storage unavailable: run in memory */
  }
  update({ loaded: true, games: games.sort(byDate), puzzles, settings });
  if (games.some((g) => !g.analysis)) void startAnalysis();
}

const persist = (p: Promise<unknown>) => p.catch(() => undefined);

export function saveSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  update({ settings });
  void persist(set('settings', settings));
}

export async function importGames(username: string, count: number) {
  update({ syncing: true, error: '' });
  try {
    const fetched = await fetchRecentGames(username, count);
    if (!fetched.length) throw new Error('Aucune partie standard trouvée pour ce joueur.');
    const known = new Set(state.games.map((g) => g.id));
    const fresh = fetched.filter((g) => !known.has(g.id));
    saveSettings({ username: username.trim(), count });
    update({ games: [...state.games, ...fresh].sort(byDate), syncing: false });
    await persist(setMany(fresh.map((g) => [`g:${g.id}`, g])));
    void startAnalysis();
  } catch (e) {
    const msg = e instanceof TypeError ? 'Impossible de joindre chess.com. Vérifie ta connexion.' : (e as Error).message;
    update({ syncing: false, error: msg });
  }
}

let engine: Engine | null = null;
let stopRequested = false;

export async function startAnalysis() {
  if (state.analysing) return;
  stopRequested = false;
  update({ analysing: true, error: '' });
  try {
    engine ??= new Engine();
    for (;;) {
      const game = state.games.find((g) => !g.analysis);
      if (!game || stopRequested) break;
      update({ currentGame: game.id, progress: 0 });
      const { analysis, puzzles } = await analyseGame(
        game,
        engine,
        state.settings.depth,
        (progress) => update({ progress }),
        () => stopRequested,
      );
      const done = { ...game, analysis };
      update({
        games: state.games.map((g) => (g.id === game.id ? done : g)),
        puzzles: [...state.puzzles, ...puzzles],
      });
      await persist(setMany([[`g:${done.id}`, done], ...puzzles.map((p): [string, Puzzle] => [`p:${p.id}`, p])]));
    }
  } catch (e) {
    if (!(e instanceof Cancelled)) update({ error: `Analyse interrompue : ${(e as Error).message}` });
  }
  update({ analysing: false, currentGame: '', progress: 0 });
}

export function stopAnalysis() {
  stopRequested = true;
}

export function savePuzzle(p: Puzzle) {
  update({ puzzles: state.puzzles.map((x) => (x.id === p.id ? p : x)) });
  void persist(set(`p:${p.id}`, p));
}

export async function resetAll() {
  stopRequested = true;
  await persist(clear());
  update({ games: [], puzzles: [], settings: { ...state.settings, username: '' }, error: '' });
}
