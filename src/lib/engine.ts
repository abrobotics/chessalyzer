import { MATE } from './classify';

export interface EngineResult {
  /** Centipawns from the side to move's point of view (mates encoded near ±MATE). */
  score: number;
  best: string;
  pv: string[];
}

/** Thin promise wrapper around a Stockfish UCI web worker. One search at a time. */
export class Engine {
  private worker: Worker;
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private listener: ((line: string) => void) | null = null;

  constructor() {
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`);
    this.worker.onmessage = (e) => {
      if (typeof e.data === 'string') this.listener?.(e.data);
    };
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker.onerror = (e) => reject(new Error(e.message || 'Moteur indisponible'));
      this.listener = (line) => {
        if (line === 'uciok') this.worker.postMessage('isready');
        if (line === 'readyok') resolve();
      };
      this.worker.postMessage('uci');
    });
  }

  analyse(fen: string, depth: number): Promise<EngineResult> {
    const run = this.queue.then(() => this.search(fen, depth));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async search(fen: string, depth: number): Promise<EngineResult> {
    await this.ready;
    return new Promise<EngineResult>((resolve) => {
      let score = 0;
      let pv: string[] = [];
      this.listener = (line) => {
        if (line.startsWith('info') && line.includes(' pv ')) {
          const m = / score (cp|mate) (-?\d+)/.exec(line);
          if (!m || / (upperbound|lowerbound)/.test(line)) return;
          const n = +m[2];
          score = m[1] === 'cp' ? Math.max(-20000, Math.min(20000, n)) : n > 0 ? MATE - n : -MATE - n;
          pv = line.split(' pv ')[1].trim().split(/\s+/);
        } else if (line.startsWith('bestmove')) {
          this.listener = null;
          const best = line.split(' ')[1];
          resolve({ score, best: best === '(none)' ? '' : best, pv: pv.length ? pv : best ? [best] : [] });
        }
      };
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  dispose() {
    this.worker.terminate();
  }
}
