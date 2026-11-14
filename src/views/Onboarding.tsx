import { useState } from 'react';
import { importGames, useStore } from '../lib/store';

export function Onboarding() {
  const s = useStore();
  const [name, setName] = useState(s.settings.username);
  const [count, setCount] = useState(s.settings.count);

  return (
    <div className="onboarding">
      <div className="hero-piece" aria-hidden="true">♞</div>
      <h1>Chessalyzer</h1>
      <p className="lead">
        Importe tes parties chess.com, découvre tes erreurs récurrentes et entraîne-toi sur les positions que tu as
        réellement ratées.
      </p>
      <form
        className="onboarding-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void importGames(name, count);
        }}
      >
        <label htmlFor="username">Pseudo chess.com</label>
        <div className="row">
          <input
            id="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. magnuscarlsen"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <select value={count} onChange={(e) => setCount(+e.target.value)} aria-label="Nombre de parties">
            {[10, 30, 50, 100].map((n) => (
              <option key={n} value={n}>{n} parties</option>
            ))}
          </select>
        </div>
        <button className="btn primary" disabled={s.syncing || !name.trim()}>
          {s.syncing ? 'Import en cours…' : 'Analyser mes parties'}
        </button>
        {s.error && <p className="error" role="alert">{s.error}</p>}
      </form>
      <ol className="steps">
        <li><b>Import</b> — tes dernières parties publiques, sans mot de passe.</li>
        <li><b>Analyse</b> — Stockfish tourne dans ton navigateur et repère chaque erreur.</li>
        <li><b>Entraînement</b> — tu rejoues tes propres gaffes jusqu’à ne plus les refaire.</li>
      </ol>
      <p className="muted small">Tout reste sur ton appareil : aucune donnée n’est envoyée ailleurs qu’à chess.com.</p>
    </div>
  );
}
