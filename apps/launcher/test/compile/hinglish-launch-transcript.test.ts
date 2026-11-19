import { describe, expect, it } from "vitest";
import { readTranscript } from "./helpers.js";

const nums = (t: string): number[] => [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
const sorted = (a: number[]): number[] => [...a].sort((x, y) => x - y);

describe("seeded-leaky-hinglish transcript (T13e)", () => {
  const hi = readTranscript("seeded-leaky-hinglish");
  const en = readTranscript("seeded-leaky");

  it("is Roman-script Hinglish, no Devanagari", () => {
    expect(hi.length).toBeGreaterThan(300);
    expect(hi).not.toMatch(/[ऀ-ॿ]/);
    expect(hi).toMatch(/\b(hai|hoon|chahiye|mein)\b/);
  });

  it("keeps the same numbers as the English transcript", () => {
    expect(sorted(nums(hi))).toEqual(sorted(nums(en)));
  });

  it("still omits the daily capacity, the rush cap and unlisted-area handling", () => {
    expect(hi).not.toMatch(/capacity|limit|per day|ek din mein|roz|daily|kul/i);
    expect(hi).not.toMatch(/rush[^.]*(max|cap|tak|sirf|at most)/i);
    expect(hi).not.toMatch(/other area|unlisted|aur kisi|baaki|kisi aur|refuse|mana\b/i);
  });
});
