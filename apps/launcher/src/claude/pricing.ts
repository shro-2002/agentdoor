export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const TOKENS_PER_MTOK = 1_000_000;

/** USD per million tokens (05 §3). */
const SONNET: Price = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 };
const HAIKU: Price = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };
const OPUS: Price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

/** Unknown models (e.g. a fallback model) are priced as Opus so the guard errs on the high side. */
export function priceFor(model: string): Price {
  if (model.includes("sonnet")) return SONNET;
  if (model.includes("haiku")) return HAIKU;
  return OPUS;
}

export function costUsd(model: string, u: Usage): number {
  const p = priceFor(model);
  const micro =
    u.inputTokens * p.input +
    u.outputTokens * p.output +
    u.cacheReadTokens * p.cacheRead +
    u.cacheWriteTokens * p.cacheWrite;
  return micro / TOKENS_PER_MTOK;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Worst case for one call: every max token is output, and input is over-counted (Devanagari is token-heavy). */
const CHARS_PER_TOKEN_ESTIMATE = 2;

export function estimateUsd(model: string, inputChars: number, maxTokens: number): number {
  const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN_ESTIMATE);
  return costUsd(model, { ...EMPTY_USAGE, inputTokens, outputTokens: maxTokens });
}
