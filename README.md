# Chessalyzer

Application web pour progresser aux échecs à partir de tes propres parties chess.com.

1. **Import** — récupère tes dernières parties via l'API publique de chess.com (pseudo uniquement, pas de mot de passe).
2. **Analyse** — Stockfish (WebAssembly) tourne dans le navigateur, évalue chaque position et classe tes coups
   (imprécision, erreur, gaffe) selon la perte de chances de gain. Chaque erreur est étiquetée : phase de jeu,
   pièce laissée en prise, tactique manquée, mat manqué ou encaissé, zeitnot, coup joué trop vite.
3. **Bilan** — précision, erreurs par phase et par motif, ouvertures, et une liste de priorités de travail.
4. **Entraînement** — chaque gaffe devient un exercice : retrouve le bon coup dans la position où tu t'es trompé.
   Répétition espacée (boîtes de Leitner) : une position ratée revient jusqu'à ce qu'elle soit maîtrisée.
5. **Revue** — rejoue chaque partie avec la courbe d'évaluation et le meilleur coup à chaque erreur.

Tout est stocké localement dans le navigateur (IndexedDB) ; il n'y a pas de serveur.

## Lancer

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # site statique dans dist/, hébergeable n'importe où
npm test
```

## Code

- `src/lib/chesscom.ts` — import des parties
- `src/lib/engine.ts` — worker Stockfish (UCI)
- `src/lib/analysis.ts`, `classify.ts` — analyse d'une partie, classification et étiquetage des erreurs
- `src/lib/stats.ts` — bilan et priorités
- `src/lib/srs.ts` — répétition espacée
- `src/views/` — Bilan, Parties (revue), Entraînement

## Licence

GPL-3.0-or-later (l'application embarque Stockfish et Chessground, tous deux sous GPL).
