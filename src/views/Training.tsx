import { Chess } from 'chess.js';
import { useEffect, useMemo, useState } from 'react';
import { Board, type Arrow } from '../components/Board';
import { evalPosition } from '../lib/analysis';
import { formatEval, winProb } from '../lib/classify';
import { Engine } from '../lib/engine';
import { CLASS_LABEL, CLASS_MARK, PHASE_LABEL, TAG_LABEL } from '../lib/labels';
import { INTERVALS, MASTERED_BOX, review } from '../lib/srs';
import { filterLabel, matchesFilter, type Filter } from '../lib/stats';
import { savePuzzle, useStore } from '../lib/store';
import type { Phase, Puzzle, Tag } from '../lib/types';

let engine: Engine | null = null;
/** How many win-probability points below the best move still counts as a good answer. */
const TOLERANCE = 5;

type Status = 'solving' | 'checking' | 'solved' | 'revealed';

function buildQueue(puzzles: Puzzle[], filter: Filter | null, all: boolean): string[] {
  const now = Date.now();
  return puzzles
    .filter((p) => matchesFilter(p, filter) && (all || p.srs.due <= now))
    .sort((a, b) => (a.srs.attempts ? 0 : 1) - (b.srs.attempts ? 0 : 1) || a.srs.due - b.srs.due || b.loss - a.loss)
    .slice(0, 20)
    .map((p) => p.id);
}

const FILTERS: Filter[] = [
  ...(['opening', 'middlegame', 'endgame'] as Phase[]).map((value): Filter => ({ kind: 'phase', value })),
  ...(['hung-piece', 'missed-tactic', 'missed-mate', 'allowed-mate', 'positional', 'time-pressure', 'too-fast'] as Tag[]).map(
    (value): Filter => ({ kind: 'tag', value }),
  ),
];

interface Props {
  filter: Filter | null;
  setFilter: (f: Filter | null) => void;
  openGame: (gameId: string, ply: number) => void;
}

export function Training({ filter, setFilter, openGame }: Props) {
  const s = useStore();
  const [all, setAll] = useState(false);
  const [queue, setQueue] = useState<string[]>(() => buildQueue(s.puzzles, filter, false));
  const [session, setSession] = useState({ done: 0, ok: 0 });
  const [round, setRound] = useState(0);

  const restart = (f: Filter | null, includeAll: boolean) => {
    setFilter(f);
    setAll(includeAll);
    setQueue(buildQueue(s.puzzles, f, includeAll));
  };

  const puzzle = s.puzzles.find((p) => p.id === queue[0]);
  const available = FILTERS.filter((f) => s.puzzles.some((p) => matchesFilter(p, f)));
  const mastered = s.puzzles.filter((p) => p.srs.box >= MASTERED_BOX).length;
  const pool = s.puzzles.filter((p) => matchesFilter(p, filter));
  const nextDue = Math.min(...pool.map((p) => p.srs.due));

  return (
    <div className="training">
      <div className="training-bar">
        <label>
          Thème{' '}
          <select
            value={filter ? `${filter.kind}:${filter.value}` : ''}
            onChange={(e) => restart(FILTERS.find((f) => `${f.kind}:${f.value}` === e.target.value) ?? null, all)}
          >
            <option value="">Toutes mes erreurs</option>
            {available.map((f) => (
              <option key={f.value} value={`${f.kind}:${f.value}`}>{filterLabel(f)}</option>
            ))}
          </select>
        </label>
        <span className="muted small">
          Session : {session.ok}/{session.done} réussis · {mastered}/{s.puzzles.length} positions maîtrisées
        </span>
      </div>

      {puzzle ? (
        <Solver
          key={puzzle.id + ':' + round}
          puzzle={puzzle}
          remaining={queue.length}
          openGame={openGame}
          onResult={(ok) => setSession((x) => ({ done: x.done + 1, ok: x.ok + (ok ? 1 : 0) }))}
          onNext={(retry) => {
            setRound((r) => r + 1);
            setQueue((q) => (retry ? [...q.slice(1), q[0]] : q.slice(1)));
          }}
        />
      ) : (
        <div className="empty">
          {!s.puzzles.length ? (
            <>
              <h2>Pas encore d’exercice</h2>
              <p className="muted">Les exercices sont créés à partir de tes erreurs, au fur et à mesure de l’analyse.</p>
            </>
          ) : !pool.length ? (
            <>
              <h2>Aucune erreur sur ce thème</h2>
              <button className="btn" onClick={() => restart(null, false)}>Voir toutes mes erreurs</button>
            </>
          ) : (
            <>
              <h2>{session.done ? 'Session terminée 🎉' : 'Rien à réviser pour l’instant'}</h2>
              <p className="muted">
                {session.done > 0 && `${session.ok} réussis sur ${session.done}. `}
                {nextDue > Date.now()
                  ? `Prochaine révision ${new Date(nextDue).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.`
                  : 'De nouvelles positions sont prêtes.'}
              </p>
              <div className="row center">
                {nextDue <= Date.now() && <button className="btn primary" onClick={() => restart(filter, false)}>Continuer</button>}
                <button className="btn" onClick={() => restart(filter, true)}>S’entraîner quand même</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface SolverProps {
  puzzle: Puzzle;
  remaining: number;
  openGame: (gameId: string, ply: number) => void;
  onResult: (ok: boolean) => void;
  onNext: (retryLater: boolean) => void;
}

function Solver({ puzzle, remaining, openGame, onResult, onNext }: SolverProps) {
  const s = useStore();
  const game = s.games.find((g) => g.id === puzzle.gameId);
  const [status, setStatus] = useState<Status>('solving');
  const [feedback, setFeedback] = useState('');
  const [recorded, setRecorded] = useState<boolean | null>(null);
  const [nonce, setNonce] = useState(0);
  const [hint, setHint] = useState(false);
  const [answer, setAnswer] = useState<{ fen: string; uci: string; san: string } | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const moveNo = useMemo(() => new Chess(puzzle.fen).moveNumber(), [puzzle.fen]);

  const record = (ok: boolean) => {
    if (recorded !== null) return;
    setRecorded(ok);
    savePuzzle({ ...puzzle, srs: review(puzzle.srs, ok) });
    onResult(ok);
  };

  const reject = (msg: string) => {
    record(false);
    setFeedback(msg);
    setStatus('solving');
    setNonce((n) => n + 1);
  };

  const play = async (from: string, to: string, promotion?: string) => {
    const c = new Chess(puzzle.fen);
    const piece = c.get(from as Parameters<Chess['get']>[0]);
    if (!promotion && piece?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      setPromo({ from, to });
      return;
    }
    setPromo(null);
    const m = c.move({ from, to, promotion });
    const uci = from + to + (promotion ?? '');
    const done = (text: string) => {
      record(true);
      setAnswer({ fen: c.fen(), uci, san: m.san });
      setFeedback(text);
      setStatus('solved');
    };
    if (uci === puzzle.bestUci) return done('Exact — c’est le meilleur coup.');
    if (uci === puzzle.playedUci) return reject(`${m.san} est le coup que tu as joué dans la partie. Cherche mieux.`);
    setStatus('checking');
    setFeedback('');
    try {
      engine ??= new Engine();
      const r = await evalPosition(engine, c.fen(), Math.min(14, s.settings.depth + 1));
      const lost = winProb(puzzle.evalBest) - winProb(-r.score);
      if (lost <= TOLERANCE) done(`Bien vu — ${m.san} est aussi un bon coup. Le moteur préfère ${puzzle.bestSan}.`);
      else reject(`${m.san} ne suffit pas (${formatEval(-r.score)}). Réessaie.`);
    } catch {
      reject(`${m.san} n’est pas le coup attendu. Réessaie.`);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (status === 'solved' || status === 'revealed')) onNext(recorded === false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finished = status === 'solved' || status === 'revealed';
  const arrows: Arrow[] =
    status === 'revealed'
      ? [{ uci: puzzle.playedUci, brush: 'red' }, { uci: puzzle.bestUci, brush: 'green' }]
      : hint && status === 'solving'
        ? [{ uci: puzzle.bestUci.slice(0, 2), brush: 'yellow' }]
        : [];

  return (
    <div className="solver">
      <div className="solver-board">
        <Board
          fen={status === 'solved' && answer ? answer.fen : puzzle.fen}
          orientation={puzzle.color}
          onMove={status === 'solving' ? (f, t) => void play(f, t) : undefined}
          lastMove={status === 'solved' && answer ? answer.uci : undefined}
          arrows={arrows}
          nonce={nonce}
        />
        {promo && (
          <div className="promo" role="dialog" aria-label="Promotion">
            {(['q', 'r', 'b', 'n'] as const).map((p) => (
              <button key={p} className="btn" onClick={() => void play(promo.from, promo.to, p)}>
                {{ q: 'Dame', r: 'Tour', b: 'Fou', n: 'Cavalier' }[p]}
              </button>
            ))}
            <button className="btn" onClick={() => { setPromo(null); setNonce((n) => n + 1); }}>Annuler</button>
          </div>
        )}
      </div>

      <div className="solver-side">
        <p className="muted small">
          {remaining} position{remaining > 1 ? 's' : ''} dans la file · {PHASE_LABEL[puzzle.phase]}
          {game && ` · contre ${game.oppName}, ${new Date(game.endTime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
        </p>
        <h2>Trait aux {puzzle.color === 'w' ? 'Blancs' : 'Noirs'} — trouve mieux</h2>
        <p>
          Au {moveNo}ᵉ coup, tu as joué{' '}
          <b className={`played ${puzzle.cls}`}>{puzzle.playedSan}{CLASS_MARK[puzzle.cls]}</b> ({CLASS_LABEL[puzzle.cls].toLowerCase()},
          −{puzzle.loss.toFixed(0)} points de chances de gain). Quel coup fallait-il jouer ?
        </p>

        <div className={`feedback ${status === 'solved' ? 'good' : feedback ? 'bad' : ''}`} role="status">
          {status === 'checking' ? 'Vérification avec le moteur…' : feedback || 'Déplace une pièce sur l’échiquier.'}
        </div>

        {finished && (
          <div className="solution">
            <div className="solution-row">
              <span>Meilleur coup</span>
              <b>{puzzle.bestSan}</b>
              <span className="num">{formatEval(puzzle.evalBest)}</span>
            </div>
            <div className="solution-row">
              <span>Ton coup en partie</span>
              <b>{puzzle.playedSan}</b>
              <span className="num">{formatEval(puzzle.evalPlayed)}</span>
            </div>
            {puzzle.line.length > 1 && (
              <p className="small">
                <span className="muted">Suite : </span>
                {puzzle.line.join(' ')}
              </p>
            )}
            <p className="muted small">
              {puzzle.tags.map((t) => TAG_LABEL[t]).join(' · ')}
              {recorded !== null &&
                ` · ${recorded ? `à revoir dans ${INTERVALS[Math.min(INTERVALS.length - 1, puzzle.srs.box)]} j` : 'reviendra dans cette session'}`}
            </p>
          </div>
        )}

        <div className="row">
          {finished ? (
            <>
              <button className="btn primary" onClick={() => onNext(recorded === false)}>Suivant ↵</button>
              <button className="btn" onClick={() => openGame(puzzle.gameId, puzzle.ply + 1)}>Voir dans la partie</button>
            </>
          ) : (
            <>
              <button className="btn" disabled={status !== 'solving' || hint} onClick={() => { record(false); setHint(true); }}>
                Indice
              </button>
              <button
                className="btn"
                disabled={status !== 'solving'}
                onClick={() => { record(false); setFeedback(`La solution était ${puzzle.bestSan}.`); setStatus('revealed'); }}
              >
                Voir la solution
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
