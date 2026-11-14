import { useState } from 'react';
import { importGames, resetAll, saveSettings, startAnalysis, stopAnalysis, useStore } from './lib/store';
import type { Filter } from './lib/stats';
import { Dashboard } from './views/Dashboard';
import { Games } from './views/Games';
import { Onboarding } from './views/Onboarding';
import { Training } from './views/Training';

type Tab = 'dashboard' | 'games' | 'training';
const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Bilan' },
  { id: 'games', label: 'Parties' },
  { id: 'training', label: 'Entraînement' },
];

export function App() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [filter, setFilter] = useState<Filter | null>(null);
  const [open, setOpen] = useState<{ gameId: string; ply: number } | null>(null);

  if (!s.loaded) return null;
  if (!s.games.length) return <Onboarding />;

  const analysed = s.games.filter((g) => g.analysis).length;
  const pending = s.games.length - analysed;
  const due = s.puzzles.filter((p) => p.srs.due <= Date.now()).length;

  const train = (f: Filter | null) => {
    setFilter(f);
    setTab('training');
  };
  const openGame = (gameId: string, ply = 0) => {
    setOpen({ gameId, ply });
    setTab('games');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">♞ Chessalyzer</div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              onClick={() => {
                setTab(t.id);
                if (t.id === 'games') setOpen(null);
              }}
            >
              {t.label}
              {t.id === 'training' && due > 0 && <span className="badge">{due}</span>}
            </button>
          ))}
        </nav>
        <div className="account">
          <button className="btn" disabled={s.syncing} onClick={() => importGames(s.settings.username, s.settings.count)}>
            {s.syncing ? 'Synchronisation…' : 'Synchroniser'}
          </button>
          <details className="menu">
            <summary aria-label="Réglages">{s.settings.username} ▾</summary>
            <div className="menu-panel">
              <label>
                Parties à importer
                <select value={s.settings.count} onChange={(e) => saveSettings({ count: +e.target.value })}>
                  {[10, 30, 50, 100].map((n) => (
                    <option key={n} value={n}>{n} dernières</option>
                  ))}
                </select>
              </label>
              <label>
                Profondeur d’analyse
                <select value={s.settings.depth} onChange={(e) => saveSettings({ depth: +e.target.value })}>
                  <option value={10}>Rapide (10)</option>
                  <option value={12}>Normale (12)</option>
                  <option value={15}>Précise (15)</option>
                </select>
              </label>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirm('Effacer toutes les parties, analyses et progrès d’entraînement ?')) void resetAll();
                }}
              >
                Tout effacer
              </button>
            </div>
          </details>
        </div>
      </header>

      {(pending > 0 || s.error) && (
        <div className="banner" role="status">
          {s.error ? (
            <span className="error">{s.error}</span>
          ) : (
            <>
              <span>
                {s.analysing ? 'Analyse en cours' : 'Analyse en pause'} — {analysed}/{s.games.length} parties
              </span>
              <div className="progress" aria-hidden="true">
                <div style={{ width: `${((analysed + s.progress) / s.games.length) * 100}%` }} />
              </div>
            </>
          )}
          {pending > 0 && (
            <button className="btn small" onClick={() => (s.analysing ? stopAnalysis() : void startAnalysis())}>
              {s.analysing ? 'Pause' : 'Reprendre'}
            </button>
          )}
        </div>
      )}

      <main>
        {tab === 'dashboard' && <Dashboard onTrain={train} />}
        {tab === 'games' && <Games open={open} setOpen={setOpen} />}
        {tab === 'training' && <Training filter={filter} setFilter={setFilter} openGame={openGame} />}
      </main>
    </div>
  );
}
