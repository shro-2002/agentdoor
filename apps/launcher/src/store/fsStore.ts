import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BusinessPolicy, Lang } from "@agentdoor/core";
import { now } from "../claude/clock.js";
import { HTTP_NOT_FOUND, LauncherError } from "../claude/errors.js";

export interface Session {
  id: string;
  createdAt: string;
  language: Lang;
  /** Fixture namespace: `compile/<fixtureKey>/round<n>`. */
  fixtureKey: string;
  /** turns[0] is the owner's description; later turns are `Q: ...\nA: ...` (05 §4). */
  turns: string[];
  clarifyUsed: boolean;
}

export interface NewSession {
  language: Lang;
  transcript: string;
  fixtureKey?: string;
}

const SESSION_ID_RE = /^s_[a-f0-9]{12}$/;
const ID_BYTES = 6;
const POLICY_FILE = /^v(\d+)\.json$/;

export const DEFAULT_STORE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.agentdoor/sessions",
);

/**
 * Filesystem store: `<root>/<sessionId>/{session.json, policies/v{n}.json, compile-v{n}.json}`.
 * Synchronous on purpose: version numbers are assigned and files renamed with no await in between,
 * so concurrent requests in one process cannot interleave.
 */
export class FsStore {
  constructor(private readonly root: string) {}

  sessionDir(id: string): string {
    if (!SESSION_ID_RE.test(id)) throw notFound(id);
    return path.join(this.root, id);
  }

  createSession(input: NewSession): Session {
    const id = `s_${randomBytes(ID_BYTES).toString("hex")}`;
    const session: Session = {
      id,
      createdAt: now().toISOString(),
      language: input.language,
      fixtureKey: input.fixtureKey ?? id.replace("_", "-"),
      turns: [input.transcript],
      clarifyUsed: false,
    };
    this.saveSession(session);
    return session;
  }

  getSession(id: string): Session {
    const file = path.join(this.sessionDir(id), "session.json");
    if (!existsSync(file)) throw notFound(id);
    return JSON.parse(readFileSync(file, "utf8")) as Session;
  }

  saveSession(session: Session): void {
    writeJson(path.join(this.sessionDir(session.id), "session.json"), session);
  }

  latestVersion(id: string): number {
    const dir = path.join(this.sessionDir(id), "policies");
    if (!existsSync(dir)) return 0;
    const versions = readdirSync(dir).flatMap((f) => {
      const m = POLICY_FILE.exec(f);
      return m ? [Number(m[1])] : [];
    });
    return Math.max(0, ...versions);
  }

  /** Writes policies/v{n}.json and compile-v{n}.json as the next version (never overwrites). */
  writeVersion(id: string, policy: BusinessPolicy, compile: unknown): number {
    const version = this.latestVersion(id) + 1;
    const dir = this.sessionDir(id);
    writeJson(path.join(dir, "policies", `v${version}.json`), policy);
    writeJson(path.join(dir, `compile-v${version}.json`), compile);
    return version;
  }

  readPolicy(id: string, version: number): BusinessPolicy {
    return readJson(path.join(this.sessionDir(id), "policies", `v${version}.json`)) as BusinessPolicy;
  }

  readCompile(id: string, version: number): unknown {
    return readJson(path.join(this.sessionDir(id), `compile-v${version}.json`));
  }
}

const notFound = (id: string): LauncherError =>
  new LauncherError("SESSION_NOT_FOUND", `No session "${id.slice(0, 40)}"`, HTTP_NOT_FOUND);

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}
