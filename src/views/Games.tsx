import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Board, type Arrow } from '../components/Board';
import { EvalChart } from '../components/charts';
import { formatEval } from '../lib/classify';
import { CLASS_LABEL, CLASS_MARK, RESULT_LABEL, TAG_LABEL, TIME_CLASS_LABEL } from '../lib/labels';
import { useStore } from '../lib/store';
import type { GameRecord } from '../lib/types';

type Open = { gameId: string; ply: number } | null;

const date = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

export function Games({ open, setOpen }: { open: Open; setOpen: (o: Open) => void }) {
  const s = useStore();
  const game = open && s.games.find((g) => g.id === open.gameId);
  if (game) return <Review key={game.id} game={game} startPly={open!.ply} onBack={() => setOpen(null)} />;

  return (
    <section className="card">
      <h2>Tes parties</h2>
      <div className="table-wrap">
        <table className="games">
          <thead>
            <tr>
              <th>Date</th>
              <th>Adversaire</th>
              <th>Résultat</th>
              <th>Cadence</th>
              <th>Ouverture</th>
              <th className="num">Précision</th>
              <th className="num">Erreurs</th>
            </tr>
          </thead>
          <tbody>
            {s.games.map((g) => (
              <tr key={g.id} className="clickable" tabIndex={0} onClick={() => setOpen({ gameId: g.id, ply: 0 })}
                onKeyDown={(e) => e.key === 'Enter' && setOpen({ gameId: g.id, ply: 0 })}>
                <td>{date(g.endTime)}</td>
                <td>
                  <span className={`side ${g.userColor === 'w' ? 'black' : 'white'}`} title={g.userColor === 'w' ? 'Tu avais les Blancs' : 'Tu avais les Noirs'} />
                  {g.oppName} <span className="muted">({g.oppRating})</span>
                </td>
                <td><span className={`result ${g.result}`}>{RESULT_LABEL[g.result]}</span></td>
                <td>{TIME_CLASS_LABEL[g.timeClass] ?? g.timeClass}</td>
                <td>{g.opening}</td>
                {g.analysis ? (
                  <>
                    <td className="num">{g.analysis.accuracy.toFixed(1)} %</td>
                    <td className="num">
                      {g.analysis.counts.blunder} gaffe{g.analysis.counts.blunder > 1 ? 's' : ''} · {g.analysis.counts.mistake} err.
                    </td>
                  </>
                ) : (
                  <td className="num muted" colSpan={2}>
                    {s.currentGame === g.id ? `Analyse ${Math.round(s.progress * 100)} %` : 'En attente'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Review({ game, startPly, onBack }: { game: GameRecord; startPly: number; onBack: () => void }) {
  const fens = useMemo(() => {
    const c = new Chess();
    c.loadPgn(game.pgn);
    const h = c.history({ verbose: true });
    return [h[0].before, ...h.map((m) => m.after)];
  }, [game.pgn]);
  const a = game.analysis;
  const [cur, setCur] = useState(Math.min(startPly, fens.length - 1));
  const listRef = useRef<HTMLDivElement>(null);
  const last = fens.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
      else if (e.key === 'ArrowRight') setCur((c) => Math.min(last, c + 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  useEffect(() => {
    listRef.current?.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  const sans = useMemo(() => {
    if (a) return a.plies.map((p) => p.san);
    const c = new Chess();
    c.loadPgn(game.pgn);
    return c.history();
  }, [a, game.pgn]);

  const ply = a && cur > 0 ? a.plies[cur - 1] : null;
  const isError = !!ply?.cls && ply.cls !== 'ok';
  // On an error, show the position before the move with both arrows.
  const arrows: Arrow[] = isError && ply!.bestUci ? [{ uci: ply!.uci, brush: 'red' }, { uci: ply!.bestUci, brush: 'green' }] : [];
  const errorPlies = a ? a.plies.flatMap((p, i) => (p.cls === 'mistake' || p.cls === 'blunder' ? [i + 1] : [])) : [];
  const nextError = errorPlies.find((i) => i > cur);

  return (
    <div className="review">
      <div className="review-board">
        <Board
          fen={isError ? fens[cur - 1] : fens[cur]}
          orientation={game.userColor}
          lastMove={!isError && cur > 0 && a ? a.plies[cur - 1].uci : undefined}
          arrows={arrows}
        />
        <div className="nav">
          <button className="btn" onClick={() => setCur(0)} disabled={cur === 0} aria-label="Début">⏮</button>
          <button className="btn" onClick={() => setCur(cur - 1)} disabled={cur === 0} aria-label="Coup précédent">◀</button>
          <button className="btn" onClick={() => setCur(cur + 1)} disabled={cur === last} aria-label="Coup suivant">▶</button>
          <button className="btn" onClick={() => setCur(last)} disabled={cur === last} aria-label="Fin">⏭</button>
          <button className="btn" disabled={!nextError} onClick={() => nextError && setCur(nextError)}>Erreur suivante</button>
        </div>
      </div>

      <div className="review-side">
        <button className="link" onClick={onBack}>← Toutes les parties</button>
        <h2>
          contre {game.oppName} <span className="muted">({game.oppRating})</span>
        </h2>
        <p className="muted small">
          {date(game.endTime)} · {TIME_CLASS_LABEL[game.timeClass] ?? game.timeClass} · {game.opening} ·{' '}
          <span className={`result ${game.result}`}>{RESULT_LABEL[game.result]}</span> ·{' '}
          <a href={game.url} target="_blank" rel="noreferrer">chess.com ↗</a>
        </p>

        {a ? (
          <>
            <div className="review-summary">
              <span><b>{a.accuracy.toFixed(1)} %</b> précision</span>
              <span className="chip blunder">{a.counts.blunder} gaffes ??</span>
              <span className="chip mistake">{a.counts.mistake} erreurs ?</span>
              <span className="chip inaccuracy">{a.counts.inaccuracy} imprécisions ?!</span>
            </div>
            <EvalChart analysis={a} current={cur} onSelect={setCur} />
            <div className={`verdict ${isError ? ply!.cls : ''}`}>
              {ply ? (
                isError ? (
                  <>
                    <b>
                      {Math.ceil(cur / 2)}{ply.color === 'w' ? '.' : '…'} {ply.san}{CLASS_MARK[ply.cls!]} — {CLASS_LABEL[ply.cls!]}
                    </b>
                    <span>
                      −{ply.loss!.toFixed(0)} points de chances de gain. Meilleur coup : <b>{ply.bestSan}</b> (flèche verte).
                    </span>
                    {ply.tags && <span className="muted small">{ply.tags.map((t) => TAG_LABEL[t]).join(' · ')}</span>}
                  </>
                ) : (
                  <span>
                    {Math.ceil(cur / 2)}{ply.color === 'w' ? '.' : '…'} {ply.san} · évaluation {formatEval(ply.evalAfter)}
                  </span>
                )
              ) : (
                <span className="muted">Utilise ← → ou clique sur le graphique pour naviguer.</span>
              )}
            </div>
          </>
        ) : (
          <p className="muted">Cette partie n’est pas encore analysée.</p>
        )}

        <div className="moves" ref={listRef}>
          {sans.map((san, i) => {
            const p = a?.plies[i];
            const cls = p?.cls && p.cls !== 'ok' ? p.cls : '';
            return (
              <span key={i} className="move-cell">
                {i % 2 === 0 && <span className="move-no">{i / 2 + 1}.</span>}
                <button className={`move ${cls} ${cur === i + 1 ? 'current' : ''}`} onClick={() => setCur(i + 1)}>
                  {san}
                  {cls && <sup>{CLASS_MARK[p!.cls!]}</sup>}
                </button>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
