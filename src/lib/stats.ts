import { PHASE_LABEL, TAG_LABEL } from './labels';
import type { GameRecord, Phase, Puzzle, Tag } from './types';

export interface Filter {
  kind: 'phase' | 'tag';
  value: string;
}

export interface Insight {
  title: string;
  text: string;
  filter?: Filter;
}

export interface Row {
  label: string;
  value: number;
  detail: string;
  filter?: Filter;
}

export interface Stats {
  analysed: number;
  accuracy: number;
  blundersPerGame: number;
  mistakesPerGame: number;
  score: number; // % of points
  trend: { label: string; accuracy: number }[]; // oldest first
  byPhase: Row[]; // serious errors per 100 moves
  byTag: Row[]; // count
  openings: { name: string; games: number; score: number; accuracy: number; errors: number }[];
  byColor: { white: number | null; black: number | null };
  insights: Insight[];
}

const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];
const MOTIFS: Tag[] = ['hung-piece', 'missed-tactic', 'missed-mate', 'allowed-mate', 'positional'];
const points = (g: GameRecord) => (g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeStats(games: GameRecord[]): Stats | null {
  const done = games.filter((g) => g.analysis);
  if (!done.length) return null;

  const moves: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  const errors: Record<Phase, number> = { opening: 0, middlegame: 0, endgame: 0 };
  const tags = new Map<Tag, number>();
  let serious = 0;
  let blunders = 0;
  let mistakes = 0;
  const openings = new Map<string, GameRecord[]>();

  for (const g of done) {
    const a = g.analysis!;
    blunders += a.counts.blunder;
    mistakes += a.counts.mistake;
    openings.set(g.opening, [...(openings.get(g.opening) ?? []), g]);
    for (const p of a.plies) {
      if (!p.phase) continue;
      moves[p.phase]++;
      if (p.cls === 'mistake' || p.cls === 'blunder') {
        errors[p.phase]++;
        serious++;
        for (const t of p.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
      }
    }
  }

  const n = done.length;
  const byPhase: Row[] = PHASES.filter((p) => moves[p] > 0).map((p) => ({
    label: PHASE_LABEL[p],
    value: (errors[p] / moves[p]) * 100,
    detail: `${errors[p]} erreurs graves sur ${moves[p]} coups`,
    filter: { kind: 'phase', value: p },
  }));
  const byTag: Row[] = MOTIFS.map((t) => ({
    label: TAG_LABEL[t],
    value: tags.get(t) ?? 0,
    detail: `${tags.get(t) ?? 0} sur ${serious} erreurs graves`,
    filter: { kind: 'tag' as const, value: t },
  }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const openingRows = [...openings.entries()]
    .map(([name, gs]) => ({
      name,
      games: gs.length,
      score: mean(gs.map(points)) * 100,
      accuracy: mean(gs.map((g) => g.analysis!.accuracy)),
      errors: mean(gs.map((g) => g.analysis!.counts.blunder + g.analysis!.counts.mistake)),
    }))
    .sort((a, b) => b.games - a.games);

  const acc = (c: 'w' | 'b') => {
    const xs = done.filter((g) => g.userColor === c).map((g) => g.analysis!.accuracy);
    return xs.length ? mean(xs) : null;
  };
  const byColor = { white: acc('w'), black: acc('b') };

  // --- Priorities -----------------------------------------------------------
  const insights: Insight[] = [];
  const phaseRows = PHASES.filter((p) => moves[p] >= 30).sort((a, b) => errors[b] / moves[b] - errors[a] / moves[a]);
  if (phaseRows.length >= 2 && errors[phaseRows[0]] > 0) {
    const p = phaseRows[0];
    const rate = (errors[p] / moves[p]) * 100;
    const advice: Record<Phase, string> = {
      opening: 'Revois les premiers coups de tes ouvertures : développement, roque, et pas de sortie de dame prématurée.',
      middlegame: 'Avant chaque coup, vérifie les échecs, les prises et les menaces — les tiens et ceux de ton adversaire.',
      endgame: 'Travaille les finales de base : activité du roi, pions passés, et calcule les courses de pions jusqu’au bout.',
    };
    insights.push({
      title: `Point faible : ${PHASE_LABEL[p].toLowerCase()}`,
      text: `${rate.toFixed(1)} erreurs graves pour 100 coups dans cette phase, ton taux le plus élevé. ${advice[p]}`,
      filter: { kind: 'phase', value: p },
    });
  }
  const topMotif = byTag[0];
  if (topMotif && serious >= 3) {
    const t = topMotif.filter!.value as Tag;
    const advice: Partial<Record<Tag, string>> = {
      'hung-piece': 'Avant de lâcher ta pièce, demande-toi : « qu’est-ce que mon coup ne défend plus ? »',
      'missed-tactic': 'Cherche systématiquement les coups forçants (échecs, prises, menaces) avant de jouer un coup tranquille.',
      'missed-mate': 'Quand le roi adverse est exposé, regarde tous les échecs disponibles avant tout autre coup.',
      'allowed-mate': 'Surveille la sécurité de ton roi : échecs adverses possibles au prochain coup, cases de fuite, couloir.',
      positional: 'Tes erreurs sont surtout stratégiques : compare ton coup aux plans du moteur dans la revue de partie.',
    };
    insights.push({
      title: `Erreur la plus fréquente : ${topMotif.label.toLowerCase()}`,
      text: `${Math.round((topMotif.value / serious) * 100)} % de tes erreurs graves. ${advice[t] ?? ''}`,
      filter: topMotif.filter,
    });
  }
  const zeitnot = tags.get('time-pressure') ?? 0;
  const fast = tags.get('too-fast') ?? 0;
  if (serious >= 5 && zeitnot / serious >= 0.25) {
    insights.push({
      title: 'Gestion du temps',
      text: `${Math.round((zeitnot / serious) * 100)} % de tes erreurs graves arrivent avec moins de 10 % de ta pendule. Joue l’ouverture plus vite pour garder du temps pour les moments critiques.`,
      filter: { kind: 'tag', value: 'time-pressure' },
    });
  } else if (serious >= 5 && fast / serious >= 0.25) {
    insights.push({
      title: 'Tu joues trop vite',
      text: `${Math.round((fast / serious) * 100)} % de tes erreurs graves sont jouées en quelques secondes alors qu’il te restait du temps. Prends une respiration avant chaque coup irréversible.`,
      filter: { kind: 'tag', value: 'too-fast' },
    });
  }
  const weakOpening = openingRows.filter((o) => o.games >= 3).sort((a, b) => a.score - b.score)[0];
  if (weakOpening && weakOpening.score < 45) {
    insights.push({
      title: `Ouverture à revoir : ${weakOpening.name}`,
      text: `${Math.round(weakOpening.score)} % des points en ${weakOpening.games} parties, avec ${weakOpening.errors.toFixed(1)} erreurs graves par partie.`,
    });
  }
  if (byColor.white !== null && byColor.black !== null && Math.abs(byColor.white - byColor.black) >= 5) {
    const weak = byColor.white < byColor.black ? 'les Blancs' : 'les Noirs';
    insights.push({
      title: `Moins précis avec ${weak}`,
      text: `Précision de ${byColor.white.toFixed(0)} % avec les Blancs contre ${byColor.black.toFixed(0)} % avec les Noirs. Consolide ton répertoire avec ${weak}.`,
    });
  }

  return {
    analysed: n,
    accuracy: mean(done.map((g) => g.analysis!.accuracy)),
    blundersPerGame: blunders / n,
    mistakesPerGame: mistakes / n,
    score: mean(done.map(points)) * 100,
    trend: [...done].reverse().map((g) => ({
      label: `${new Date(g.endTime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} · ${g.oppName}`,
      accuracy: g.analysis!.accuracy,
    })),
    byPhase,
    byTag,
    openings: openingRows.slice(0, 8),
    byColor,
    insights: insights.slice(0, 4),
  };
}

export function matchesFilter(p: Puzzle, f: Filter | null): boolean {
  if (!f) return true;
  return f.kind === 'phase' ? p.phase === f.value : p.tags.includes(f.value as Tag);
}

export function filterLabel(f: Filter): string {
  return f.kind === 'phase' ? PHASE_LABEL[f.value as Phase] : TAG_LABEL[f.value as Tag];
}
