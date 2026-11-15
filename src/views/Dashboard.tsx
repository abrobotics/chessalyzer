import { useMemo } from 'react';
import { BarList, TrendChart } from '../components/charts';
import { computeStats, type Filter } from '../lib/stats';
import { useStore } from '../lib/store';

export function Dashboard({ onTrain }: { onTrain: (f: Filter | null) => void }) {
  const s = useStore();
  const stats = useMemo(() => computeStats(s.games), [s.games]);
  const due = s.puzzles.filter((p) => p.srs.due <= Date.now()).length;

  if (!stats) {
    return (
      <div className="empty">
        <h2>Première analyse en cours…</h2>
        <p className="muted">Ton bilan apparaîtra dès qu’une partie sera analysée (quelques secondes à une minute par partie).</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <section className="kpis">
        <div className="kpi">
          <span className="kpi-label">Précision moyenne</span>
          <span className="kpi-value">{stats.accuracy.toFixed(1)} %</span>
          <span className="muted small">{stats.analysed} parties analysées</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Gaffes par partie</span>
          <span className="kpi-value">{stats.blundersPerGame.toFixed(1)}</span>
          <span className="muted small">+ {stats.mistakesPerGame.toFixed(1)} erreurs</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Score</span>
          <span className="kpi-value">{stats.score.toFixed(0)} %</span>
          <span className="muted small">des points marqués</span>
        </div>
        <div className="kpi cta">
          <span className="kpi-label">À réviser aujourd’hui</span>
          <span className="kpi-value">{due}</span>
          <button className="btn primary small" disabled={!s.puzzles.length} onClick={() => onTrain(null)}>
            S’entraîner
          </button>
        </div>
      </section>

      {stats.insights.length > 0 && (
        <section className="card">
          <h2>Tes priorités</h2>
          <div className="insights">
            {stats.insights.map((i, k) => (
              <article className="insight" key={i.title}>
                <span className="insight-rank">{k + 1}</span>
                <div>
                  <h3>{i.title}</h3>
                  <p>{i.text}</p>
                  {i.filter && (
                    <button className="link" onClick={() => onTrain(i.filter!)}>Travailler ce thème →</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="grid2">
        <section className="card">
          <h2>Erreurs graves par phase</h2>
          <p className="muted small">Gaffes et erreurs pour 100 coups joués dans la phase</p>
          <BarList rows={stats.byPhase} unit={(v) => v.toFixed(1)} onTrain={onTrain} />
        </section>
        <section className="card">
          <h2>Types d’erreurs</h2>
          <p className="muted small">Nombre de gaffes et d’erreurs par motif</p>
          {stats.byTag.length ? (
            <BarList rows={stats.byTag} unit={(v) => String(v)} onTrain={onTrain} />
          ) : (
            <p className="muted">Aucune erreur grave détectée pour l’instant.</p>
          )}
        </section>
      </div>

      {stats.trend.length >= 2 && (
        <section className="card">
          <h2>Précision partie après partie</h2>
          <p className="muted small">De la plus ancienne à la plus récente</p>
          <TrendChart points={stats.trend} />
        </section>
      )}

      <section className="card">
        <h2>Ouvertures</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ouverture</th>
                <th className="num">Parties</th>
                <th className="num">Score</th>
                <th className="num">Précision</th>
                <th className="num hide-sm">Erreurs graves / partie</th>
              </tr>
            </thead>
            <tbody>
              {stats.openings.map((o) => (
                <tr key={o.name}>
                  <td>{o.name}</td>
                  <td className="num">{o.games}</td>
                  <td className="num">{o.score.toFixed(0)} %</td>
                  <td className="num">{o.accuracy.toFixed(1)} %</td>
                  <td className="num hide-sm">{o.errors.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
