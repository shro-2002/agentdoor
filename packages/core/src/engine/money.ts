const BASIS_POINTS = 10_000n;
const HALF_BASIS_POINT = 5_000n;

/**
 * `bp` basis points of `paise`, rounded half-up to a whole paisa.
 * BigInt keeps the intermediate product exact beyond 2^53.
 */
export const percentOf = (paise: number, bp: number): number =>
  Number((BigInt(paise) * BigInt(bp) + HALF_BASIS_POINT) / BASIS_POINTS);

export const sumPaise = (values: readonly number[]): number =>
  values.reduce((total, v) => total + v, 0);
