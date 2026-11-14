import type { MoveClass, Phase, Tag } from './types';

export const PHASE_LABEL: Record<Phase, string> = {
  opening: 'Ouverture',
  middlegame: 'Milieu de jeu',
  endgame: 'Finale',
};

export const TAG_LABEL: Record<Tag, string> = {
  'missed-mate': 'Mat manqué',
  'allowed-mate': 'Mat encaissé',
  'hung-piece': 'Pièce laissée en prise',
  'missed-tactic': 'Tactique manquée',
  positional: 'Erreur positionnelle',
  'time-pressure': 'Zeitnot',
  'too-fast': 'Coup joué trop vite',
};

export const CLASS_LABEL: Record<MoveClass, string> = {
  ok: 'Bon coup',
  inaccuracy: 'Imprécision',
  mistake: 'Erreur',
  blunder: 'Gaffe',
};

export const CLASS_MARK: Record<MoveClass, string> = { ok: '', inaccuracy: '?!', mistake: '?', blunder: '??' };

export const TIME_CLASS_LABEL: Record<string, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapide',
  daily: 'Différé',
};

export const RESULT_LABEL = { win: 'Victoire', loss: 'Défaite', draw: 'Nulle' } as const;
