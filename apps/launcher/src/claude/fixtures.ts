import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HTTP_UNAVAILABLE, LauncherError, validationFailed } from "./errors.js";
import type { Usage } from "./pricing.js";

export interface RecordedAttempt {
  rawText: string;
  stopReason: string | null;
  model: string;
  usage: Usage;
  /** Wall time of the API call; absent in fixtures recorded before T08. */
  latencyMs?: number;
}

export interface Fixture {
  fixtureId: string;
  flow: string;
  model: string;
  recordedAt: string;
  /** Only used to print a drift warning on replay; never a lookup key (R0-5). */
  promptHash: string;
  attempts: RecordedAttempt[];
}

const FIXTURE_ID_RE = /^[a-z0-9-]+(\/[a-z0-9-]+){0,3}$/;

export function fixturePath(dir: string, fixtureId: string): string {
  if (!FIXTURE_ID_RE.test(fixtureId)) throw validationFailed(`bad fixtureId "${fixtureId}"`);
  return path.join(dir, `${fixtureId}.json`);
}

/** Hash of the static prompt parts only: the date-bearing user turn is excluded on purpose. */
export const promptHash = (system: string, schema: unknown): string =>
  createHash("sha256").update(system).update("\n").update(JSON.stringify(schema)).digest("hex").slice(0, 16);

export function readFixture(dir: string, fixtureId: string): Fixture {
  const file = fixturePath(dir, fixtureId);
  if (!existsSync(file))
    throw new LauncherError("FIXTURE_MISSING", `No recorded fixture "${fixtureId}" (replay mode never calls the API)`, HTTP_UNAVAILABLE);
  return JSON.parse(readFileSync(file, "utf8")) as Fixture;
}

export function writeFixture(dir: string, fixture: Fixture): void {
  const file = fixturePath(dir, fixture.fixtureId);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(fixture, null, 2)}\n`);
  renameSync(tmp, file);
}
