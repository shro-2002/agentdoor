import { sha256Hex } from "../hash.js";

const SEED_HEX_CHARS = 8;
const HEX_RADIX = 16;
const UINT32_RANGE = 2 ** 32;
/** mulberry32's published mixing constants; any change would change every simulation. */
const MIX_INCREMENT = 0x6d2b79f5;
const MIX_OR = 61;

/** A small deterministic random source: the same seed text always yields the same sequence. */
export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** A whole number in [min, max], both included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** A new array in a random order (Fisher-Yates); the input is left alone. */
  shuffle<T>(items: readonly T[]): T[];
}

export function seededRng(seedText: string): Rng {
  let state = parseInt(sha256Hex(seedText).slice(0, SEED_HEX_CHARS), HEX_RADIX) | 0;
  const next = (): number => {
    state = (state + MIX_INCREMENT) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), MIX_OR | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return { next, int, pick, shuffle };
}
