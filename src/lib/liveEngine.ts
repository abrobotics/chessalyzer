import { Engine } from './engine';

let engine: Engine | null = null;

/** Engine for interactive use (training checks, exploration), separate from the background analysis. */
export const liveEngine = (): Engine => (engine ??= new Engine());
