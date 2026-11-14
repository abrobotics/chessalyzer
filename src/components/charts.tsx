import { useState, type MouseEvent } from 'react';
import { formatEval, winProb } from '../lib/classify';
import { CLASS_LABEL } from '../lib/labels';
import type { Filter, Row } from '../lib/stats';
import type { GameAnalysis } from '../lib/types';

export function BarList({ rows, unit, onTrain }: { rows: Row[]; unit: (v: number) => string; onTrain?: (f: Filter) => void }) {
  const max = Math.max(...rows.map((r) => r.value), 0.0001);
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div className="barrow" key={r.label} title={r.detail}>
          <div className="barrow-head">
            <span>{r.label}</span>
            <span className="num">{unit(r.value)}</span>
          </div>
          <div className="bar-track">
            <div className="bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="barrow-foot">
            <span className="muted small">{r.detail}</span>
            {onTrain && r.filter && (
              <button className="link" onClick={() => onTrain(r.filter!)}>S’entraîner →</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Accuracy per game, oldest to newest. */
export function TrendChart({ points }: { points: { label: string; accuracy: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = points.length;
  const lo = Math.max(0, Math.floor((Math.min(...points.map((p) => p.accuracy)) - 5) / 10) * 10);
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - ((v - lo) / (100 - lo)) * 100;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.accuracy)}`).join(' ');
  const ticks = [lo, (lo + 100) / 2, 100];

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };

  return (
    <div className="trend">
      <div className="trend-axis">
        {ticks.map((t) => (
          <span key={t} style={{ top: `${y(t)}%` }}>{t} %</span>
        ))}
      </div>
      <div className="trend-plot" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <div key={t} className="gridline" style={{ top: `${y(t)}%` }} />
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Précision par partie">
          <path d={path} className="trend-line" vectorEffect="non-scaling-stroke" />
        </svg>
        {n <= 40 &&
          points.map((p, i) => (
            <span key={i} className="trend-dot" style={{ left: `${x(i)}%`, top: `${y(p.accuracy)}%` }} />
          ))}
        {hover !== null && (
          <>
            <div className="crosshair" style={{ left: `${x(hover)}%` }} />
            <span className="trend-dot big" style={{ left: `${x(hover)}%`, top: `${y(points[hover].accuracy)}%` }} />
            <div className={x(hover) > 60 ? 'tooltip left' : 'tooltip'} style={{ left: `${x(hover)}%` }}>
              <b>{points[hover].accuracy.toFixed(1)} %</b>
              <span>{points[hover].label}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** White's winning chances across the game; dots mark the user's errors. */
export function EvalChart({ analysis, current, onSelect }: { analysis: GameAnalysis; current: number; onSelect: (i: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const evals = [analysis.startEval, ...analysis.plies.map((p) => p.evalAfter)];
  const n = evals.length - 1;
  const x = (i: number) => (i / Math.max(1, n)) * 100;
  const y = (cp: number) => 100 - winProb(cp);
  const area = `M0,100 ${evals.map((e, i) => `L${x(i)},${y(e)}`).join(' ')} L100,100 Z`;

  const at = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n)));
  };
  const h = hover !== null && hover > 0 ? analysis.plies[hover - 1] : null;

  return (
    <div
      className="evalchart"
      onMouseMove={(e) => setHover(at(e))}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => onSelect(at(e))}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Évaluation au fil de la partie">
        <path d={area} className="eval-area" />
        <line x1="0" x2="100" y1="50" y2="50" className="eval-mid" vectorEffect="non-scaling-stroke" />
      </svg>
      {analysis.plies.map((p, i) =>
        p.cls && p.cls !== 'ok' ? (
          <span key={i} className={`eval-dot ${p.cls}`} style={{ left: `${x(i + 1)}%`, top: `${y(p.evalAfter)}%` }} />
        ) : null,
      )}
      <div className="cursor" style={{ left: `${x(current)}%` }} />
      {hover !== null && (
        <>
          <div className="crosshair" style={{ left: `${x(hover)}%` }} />
          <div className={x(hover) > 60 ? 'tooltip left' : 'tooltip'} style={{ left: `${x(hover)}%` }}>
            <b>{formatEval(evals[hover])}</b>
            <span>
              {h ? `${Math.ceil(hover / 2)}${h.color === 'w' ? '.' : '…'} ${h.san}` : 'Position initiale'}
              {h?.cls && h.cls !== 'ok' ? ` — ${CLASS_LABEL[h.cls]}` : ''}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
