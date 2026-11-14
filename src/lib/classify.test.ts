import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { MATE, classify, formatEval, moveAccuracy, parseClocks, parseTimeControl, phaseOf, winProb } from './classify';
import { review, newSrs } from './srs';

describe('classify', () => {
  it('maps centipawns to win probability', () => {
    expect(winProb(0)).toBeCloseTo(50);
    expect(winProb(300)).toBeGreaterThan(70);
    expect(winProb(MATE - 3)).toBe(100);
    expect(winProb(-MATE + 2)).toBe(0);
  });
  it('classifies by win-probability loss', () => {
    expect(classify(2)).toBe('ok');
    expect(classify(7)).toBe('inaccuracy');
    expect(classify(12)).toBe('mistake');
    expect(classify(30)).toBe('blunder');
    expect(moveAccuracy(0)).toBeCloseTo(100, 2);
    expect(moveAccuracy(50)).toBeLessThan(15);
  });
  it('formats evaluations', () => {
    expect(formatEval(134)).toBe('+1.3');
    expect(formatEval(-MATE + 4)).toBe('-M4');
  });
  it('parses clocks and time controls', () => {
    expect(parseClocks('1. e4 {[%clk 0:09:58.3]} e5 {[%clk 0:10:00]}')).toEqual([598.3, 600]);
    expect(parseTimeControl('180+2')).toEqual({ base: 180, inc: 2, daily: false });
    expect(parseTimeControl('1/86400').daily).toBe(true);
  });
  it('detects game phases', () => {
    expect(phaseOf(new Chess())).toBe('opening');
    expect(phaseOf(new Chess('8/5pk1/6p1/8/8/6P1/5PK1/3R4 w - - 0 40'))).toBe('endgame');
    expect(phaseOf(new Chess('r2q1rk1/pp2bppp/2n1bn2/3p4/3P4/2N1BN2/PP2BPPP/R2Q1RK1 w - - 0 14'))).toBe('middlegame');
  });
});

describe('srs', () => {
  it('promotes on success and resets on failure', () => {
    const now = 1_000_000;
    const a = review(newSrs(), true, now);
    expect(a.box).toBe(1);
    expect(a.due).toBe(now + 86_400_000);
    const b = review(a, false, now);
    expect(b.box).toBe(0);
    expect(b.due).toBeLessThan(now + 3_600_000);
    expect(b.attempts).toBe(2);
  });
});
