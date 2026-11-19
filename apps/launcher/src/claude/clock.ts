import { istDateOf } from "@agentdoor/core";
import { validationFailed } from "./errors.js";

/**
 * The only clock in the launcher's Claude path. AGENTDOOR_NOW (ISO) pins it for tests and the demo
 * export; it is read on every call so a test can change it between calls.
 */
export function now(): Date {
  const pinned = process.env.AGENTDOOR_NOW;
  if (!pinned) return new Date();
  const d = new Date(pinned);
  if (Number.isNaN(d.getTime())) throw validationFailed("AGENTDOOR_NOW is not an ISO date");
  return d;
}

export const todayIst = (at: Date = now()): string => istDateOf(at.getTime());
