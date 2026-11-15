import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Board, type Arrow } from '../components/Board';
import { evalPosition, lineToSan } from '../lib/analysis';
import { formatEval, winProb } from '../lib/classify';
import { Engine } from '../lib/engine';
import { CLASS_LABEL, CLASS_MARK, PHASE_LABEL, TAG_LABEL } from '../lib/labels';
import { buildFrames, summarise } from '../lib/line';
import { INTERVALS, MASTERED_BOX, review } from '../lib/srs';
import { filterLabel, matchesFilter, type Filter } from '../lib/stats';
import { patchPuzzle, savePuzzle, useStore } from '../lib/store';
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

type DemoKind = 'best' | 'played';

/**
 * Follow-up after the first move: the trainee keeps playing the best line.
 * `step` moves of the line are on the board. In phase `auto` the next move is
 * played for them (opponent replies, or a move they asked to be shown).
 */
interface Follow {
  step: number;
  phase: 'auto' | 'me' | 'checking' | 'done';
  preview: boolean;
  /** A good move that leaves the engine line: shown on the board, ends the follow-up. */
  alt?: { fen: string; uci: string };
}

function Solver({ puzzle, remaining, openGame, onResult, onNext }: SolverProps) {
  const s = useStore();
  const game = s.games.find((g) => g.id === puzzle.gameId);
  const [status, setStatus] = useState<Status>('solving');
  const [feedback, setFeedback] = useState('');
  const [recorded, setRecorded] = useState<boolean | null>(null);
  const [nonce, setNonce] = useState(0);
  const [hint, setHint] = useState(false);
  const [showPlayed, setShowPlayed] = useState(false);
  const [answer, setAnswer] = useState<{ fen: string; uci: string } | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [follow, setFollow] = useState<Follow | null>(null);
  // Animated replay of a line: `step` moves are on the board, `preview` shows the arrow of the next one.
  const [demo, setDemo] = useState<{ kind: DemoKind; step: number; preview: boolean; playing: boolean } | null>(null);
  const moveNo = useMemo(() => new Chess(puzzle.fen).moveNumber(), [puzzle.fen]);

  const lines = useMemo(
    () => ({
      best: buildFrames(puzzle.fen, puzzle.line.slice(0, 6), puzzle.color),
      played: buildFrames(puzzle.fen, (puzzle.refutation ?? [puzzle.playedSan]).slice(0, 6), puzzle.color),
    }),
    [puzzle.fen, puzzle.line, puzzle.refutation, puzzle.playedSan, puzzle.color],
  );
  const best = lines.best;
  const frames = demo ? lines[demo.kind] : [];
  const finished = status === 'solved' || status === 'revealed';
  const following = !!follow && follow.phase !== 'done';
  const myTurn = status === 'solving' || follow?.phase === 'me';

  const record = (ok: boolean) => {
    if (recorded !== null) return;
    setRecorded(ok);
    savePuzzle({ ...puzzle, srs: review(puzzle.srs, ok) });
    onResult(ok);
  };

  const boardRef = useRef<HTMLDivElement>(null);
  /** On a phone, bring the board to the top so the board and its caption fit on one screen. */
  const focusBoard = () => {
    if (window.innerWidth <= 640) boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const startDemo = (kind: DemoKind) => setDemo({ kind, step: 0, preview: false, playing: true });

  /** Follow-up state once `step` moves of the best line are on the board. */
  const followAt = (step: number): Follow => ({
    step,
    preview: false,
    phase: step >= best.length ? 'done' : best[step].mine ? 'me' : 'auto',
  });

  const reject = (msg: string) => {
    setFeedback(msg);
    setNonce((n) => n + 1);
  };

  const check = async (fen: string) => {
    engine ??= new Engine();
    const r = await evalPosition(engine, fen, Math.min(14, s.settings.depth + 1));
    return { ok: winProb(puzzle.evalBest) - winProb(-r.score) <= TOLERANCE, score: -r.score };
  };

  const play = async (from: string, to: string, promotion?: string) => {
    const step = follow?.step ?? 0;
    const c = new Chess(step ? best[step - 1].fen : puzzle.fen);
    const piece = c.get(from as Parameters<Chess['get']>[0]);
    if (!promotion && piece?.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      setPromo({ from, to });
      return;
    }
    setPromo(null);
    setShowPlayed(false);
    setHint(false);
    const m = c.move({ from, to, promotion });
    const uci = from + to + (promotion ?? '');

    if (follow) {
      // Later moves of the line: practice only, the review result is already recorded.
      const expected = best[step];
      if (uci === expected.uci) {
        setFeedback(step + 1 >= best.length ? 'Exact — tu as trouvé toute la suite.' : 'Exact !');
        setFollow(followAt(step + 1));
        return;
      }
      setFollow({ ...follow, phase: 'checking' });
      setFeedback('');
      const r = await check(c.fen()).catch(() => null);
      if (r?.ok) {
        setFeedback(`${m.san} est aussi un bon coup. Le moteur préférait ${expected.san}.`);
        setFollow({ ...follow, phase: 'done', alt: { fen: c.fen(), uci } });
      } else {
        setFollow({ ...follow, phase: 'me' });
        reject(r ? `${m.san} ne suffit pas (${formatEval(r.score)}). Réessaie.` : `${m.san} n’est pas le coup attendu. Réessaie.`);
      }
      return;
    }

    const done = (text: string, onLine: boolean) => {
      record(true);
      setAnswer({ fen: c.fen(), uci });
      setFeedback(text);
      setStatus('solved');
      if (onLine) setFollow(followAt(1));
    };
    if (uci === puzzle.bestUci) return done(best.length > 1 ? 'Exact — c’est le meilleur coup. Trouve la suite.' : 'Exact — c’est le meilleur coup.', true);
    if (uci === puzzle.playedUci) {
      record(false);
      return reject(`${m.san} est le coup que tu as joué dans la partie. Cherche mieux.`);
    }
    setStatus('checking');
    setFeedback('');
    const r = await check(c.fen()).catch(() => null);
    if (r?.ok) return done(`Bien vu — ${m.san} est aussi un bon coup. Le moteur préfère ${puzzle.bestSan}.`, false);
    record(false);
    setStatus('solving');
    reject(r ? `${m.san} ne suffit pas (${formatEval(r.score)}). Réessaie.` : `${m.san} n’est pas le coup attendu. Réessaie.`);
  };

  const followStep = follow?.step;
  const demoKind = demo?.kind;
  useEffect(() => {
    if (demoKind || followStep !== undefined) focusBoard();
  }, [demoKind, followStep]);

  // The mistake arrow is only a reminder: it fades after a moment.
  useEffect(() => {
    if (!showPlayed) return;
    const t = setTimeout(() => setShowPlayed(false), 2500);
    return () => clearTimeout(t);
  }, [showPlayed]);

  // Older puzzles have no stored punishment line: ask the engine once the answer is known.
  useEffect(() => {
    if (!finished || puzzle.refutation) return;
    let cancelled = false;
    const c = new Chess(puzzle.fen);
    c.move(puzzle.playedSan);
    engine ??= new Engine();
    void evalPosition(engine, c.fen(), Math.min(14, s.settings.depth + 1)).then((r) => {
      if (!cancelled) patchPuzzle(puzzle.id, { refutation: lineToSan(puzzle.fen, [puzzle.playedUci, ...r.pv]) });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, puzzle.refutation]);

  // Moves played for the trainee: show the arrow, then slide the piece.
  useEffect(() => {
    if (follow?.phase !== 'auto') return;
    const t = setTimeout(
      () => setFollow(follow.preview ? followAt(follow.step + 1) : { ...follow, preview: true }),
      follow.preview ? 750 : 600,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);

  // Replay clock: show the arrow of the next move, then slide the piece.
  useEffect(() => {
    if (!demo?.playing) return;
    if (demo.step >= frames.length) {
      setDemo({ ...demo, playing: false });
      return;
    }
    const t = setTimeout(
      () => setDemo(demo.preview ? { ...demo, step: demo.step + 1, preview: false } : { ...demo, preview: true }),
      demo.preview ? 750 : demo.step === 0 ? 500 : 650,
    );
    return () => clearTimeout(t);
  }, [demo, frames.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && finished && !following) onNext(recorded === false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const goTo = (step: number) => demo && setDemo({ ...demo, step: Math.max(0, Math.min(frames.length, step)), preview: false, playing: false });
  const nextSquare = (follow ? best[follow.step]?.uci : puzzle.bestUci)?.slice(0, 2);

  let fen = puzzle.fen;
  let lastMove: string | undefined;
  let arrows: Arrow[] = [];
  if (demo) {
    fen = demo.step ? frames[demo.step - 1].fen : puzzle.fen;
    lastMove = demo.step ? frames[demo.step - 1].uci : undefined;
    const next = frames[demo.step];
    if (demo.preview && next) arrows = [{ uci: next.uci, brush: !next.mine ? 'blue' : demo.kind === 'played' && demo.step === 0 ? 'red' : 'green' }];
  } else if (follow) {
    fen = follow.alt?.fen ?? (follow.step ? best[follow.step - 1].fen : puzzle.fen);
    lastMove = follow.alt?.uci ?? (follow.step ? best[follow.step - 1].uci : undefined);
    const next = best[follow.step];
    if (follow.phase === 'auto' && follow.preview && next) arrows = [{ uci: next.uci, brush: next.mine ? 'green' : 'blue' }];
    if (follow.phase === 'me' && hint && nextSquare) arrows = [{ uci: nextSquare, brush: 'yellow' }];
  } else if (status === 'solved' && answer) {
    fen = answer.fen;
    lastMove = answer.uci;
  } else if (status === 'solving') {
    if (showPlayed) arrows.push({ uci: puzzle.playedUci, brush: 'red' });
    if (hint && nextSquare) arrows.push({ uci: nextSquare, brush: 'yellow' });
  }

  const shown = demo ? demo.step : follow && !follow.alt ? follow.step : 0;
  const shownFrames = demo ? frames : best;
  const current = shown > 0 ? shownFrames[shown - 1] : null;
  const atEnd = !!demo && demo.step >= frames.length;
  const idle = status === 'solving' ? 'Déplace une pièce sur l’échiquier.' : follow?.phase === 'me' ? 'À toi : trouve le coup suivant.' : '';
  const busy = status === 'checking' || follow?.phase === 'checking';
  const failed = /Réessaie|Cherche mieux|La solution était|Le coup était/.test(feedback);
  const message =
    [feedback, /(Réessaie|Cherche mieux|Trouve la suite)\.$/.test(feedback) ? '' : idle].filter(Boolean).join(' ') ||
    (follow?.phase === 'auto' ? 'L’adversaire répond…' : 'Suite terminée.');

  return (
    <div className={finished ? 'solver finished' : 'solver'}>
      <div className="solver-head">
        <p className="muted small">
          {remaining} position{remaining > 1 ? 's' : ''} · {PHASE_LABEL[puzzle.phase]}
          {game && ` · contre ${game.oppName}, ${new Date(game.endTime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
        </p>
        <h2>Trait aux {puzzle.color === 'w' ? 'Blancs' : 'Noirs'} — trouve mieux</h2>
        <p className="prompt">
          Au {moveNo}ᵉ coup, tu as joué{' '}
          <button
            className={`played ${puzzle.cls}`}
            disabled={status !== 'solving'}
            onClick={() => setShowPlayed(true)}
            title="Montrer ce coup sur l’échiquier"
          >
            {puzzle.playedSan}{CLASS_MARK[puzzle.cls]}
          </button>{' '}
          <span className="muted">
            ({CLASS_LABEL[puzzle.cls].toLowerCase()}, −{puzzle.loss.toFixed(0)} pts de chances de gain
            {status === 'solving' && ' · touche le coup pour le voir'})
          </span>
        </p>
      </div>

      <div className="solver-board" ref={boardRef}>
        <Board
          fen={fen}
          orientation={puzzle.color}
          onMove={myTurn && !demo ? (f, t) => void play(f, t) : undefined}
          lastMove={lastMove}
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

      <div className="solver-body">
        {finished && (
          <div className="demo">
            <p className="demo-caption" aria-live="polite">
              {current ? (
                <>
                  <span className={`who ${current.mine ? 'me' : 'opp'}`} />
                  {current.caption}
                </>
              ) : (
                <span className="muted">{demo ? 'Position de départ' : 'Suite terminée'}</span>
              )}
            </p>
            <div className="demo-steps">
              {shownFrames.map((f, i) => (
                <button
                  key={i}
                  className={`${f.mine ? 'me' : 'opp'} ${i < shown ? 'done' : ''} ${i === shown - 1 ? 'current' : ''}`}
                  onClick={() => goTo(i + 1)}
                  disabled={!demo}
                  aria-label={demo ? f.caption : `Coup ${i + 1}`}
                />
              ))}
            </div>

            {demo ? (
              <>
                {atEnd && (
                  <p className={`demo-summary ${demo.kind}`}>
                    {summarise(puzzle.fen, frames, puzzle.color)}{' '}
                    <span className="muted">Évaluation : {formatEval(demo.kind === 'best' ? puzzle.evalBest : puzzle.evalPlayed)}</span>
                  </p>
                )}
                <div className="demo-controls">
                  <button className="btn" onClick={() => goTo(demo.step - 1)} disabled={demo.step === 0} aria-label="Coup précédent">◀</button>
                  <button
                    className="btn"
                    onClick={() => (atEnd ? startDemo(demo.kind) : setDemo({ ...demo, playing: !demo.playing, preview: false }))}
                  >
                    {atEnd ? '↺ Rejouer' : demo.playing ? '⏸ Pause' : '▶ Lecture'}
                  </button>
                  <button className="btn" onClick={() => goTo(demo.step + 1)} disabled={atEnd} aria-label="Coup suivant">▶</button>
                </div>
              </>
            ) : (
              follow?.phase === 'done' && !follow.alt && (
                <p className="demo-summary">
                  {summarise(puzzle.fen, best, puzzle.color)}{' '}
                  <span className="muted">Évaluation : {formatEval(puzzle.evalBest)}</span>
                </p>
              )
            )}

            {!following && (
              <>
                <div className="demo-tabs" role="tablist" aria-label="Suite à revoir">
                  <button role="tab" aria-selected={demo?.kind === 'best'} className={demo?.kind === 'best' ? 'active' : ''} onClick={() => startDemo('best')}>
                    <span>▶ Revoir le bon coup</span>
                    <b>{puzzle.bestSan} · {formatEval(puzzle.evalBest)}</b>
                  </button>
                  <button role="tab" aria-selected={demo?.kind === 'played'} className={demo?.kind === 'played' ? 'active' : ''} onClick={() => startDemo('played')}>
                    <span>▶ Voir mon coup puni</span>
                    <b>{puzzle.playedSan} · {formatEval(puzzle.evalPlayed)}</b>
                  </button>
                </div>
                <p className="muted small">
                  {puzzle.tags.map((t) => TAG_LABEL[t]).join(' · ')}
                  {recorded !== null &&
                    ` · ${recorded ? `à revoir dans ${INTERVALS[Math.min(INTERVALS.length - 1, puzzle.srs.box)]} j` : 'reviendra dans cette session'}`}
                </p>
              </>
            )}
          </div>
        )}

        {!demo && (
          <div className={`feedback ${busy || !feedback ? '' : failed ? 'bad' : 'good'}`} role="status">
            {busy ? 'Vérification avec le moteur…' : message}
          </div>
        )}

        <div className="row actions">
          {status === 'solving' || status === 'checking' ? (
            <>
              <button className="btn" disabled={status !== 'solving' || hint} onClick={() => { record(false); setHint(true); }}>
                Indice
              </button>
              <button
                className="btn"
                disabled={status !== 'solving'}
                onClick={() => {
                  record(false);
                  setHint(false);
                  setFeedback(`La solution était ${puzzle.bestSan}.`);
                  setStatus('revealed');
                  setFollow({ step: 0, phase: 'auto', preview: false });
                }}
              >
                Voir la solution
              </button>
            </>
          ) : following ? (
            <>
              <button className="btn" disabled={follow!.phase !== 'me' || hint} onClick={() => setHint(true)}>Indice</button>
              <button
                className="btn"
                disabled={follow!.phase !== 'me'}
                onClick={() => {
                  setHint(false);
                  setFeedback(`Le coup était ${best[follow!.step].san}.`);
                  setFollow({ ...follow!, phase: 'auto', preview: false });
                }}
              >
                Montrer
              </button>
              <button className="btn" onClick={() => onNext(recorded === false)}>Passer</button>
            </>
          ) : (
            <>
              <button className="btn primary" onClick={() => onNext(recorded === false)}>Suivant</button>
              <button className="btn" onClick={() => openGame(puzzle.gameId, puzzle.ply + 1)}>Voir dans la partie</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
