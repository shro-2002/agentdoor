import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { DeployError } from "./errors.js";
import { stdoutLog, type DeployLog } from "./log.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 8 * 1024 * 1024;
const JSON_START = /^\s*[{[]/;

export interface ExecResult {
  stdout: string;
  /** Only ever parsed for the HTTP status of an error document; never logged. */
  stderr?: string;
  failed: boolean;
  killed: boolean;
}
export type ExecFn = (
  file: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

// stderr can echo argv: it is returned only so the HTTP status can be read from it, never shown.
const defaultExec: ExecFn = (file, args, opts) =>
  new Promise((resolve) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      resolve({ stdout, stderr, failed: err !== null, killed: Boolean(err?.killed) });
    });
  });

/**
 * gddy prints update notices around its JSON, so parse stdout only: the whole text first, then from
 * the first line that starts a JSON value.
 */
export function parseStdoutJson(stdout: string): unknown {
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!JSON_START.test(lines[i] ?? "")) continue;
      try {
        return JSON.parse(lines.slice(i).join("\n"));
      } catch {
        // keep scanning: a notice line may itself start with a bracket
      }
    }
  }
  throw new DeployError("GDDY_NO_JSON", "gddy printed no JSON on stdout");
}

function errorCodeOf(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const err = (parsed as { error?: unknown }).error;
  if (err === undefined || err === null || err === false) return null;
  const code = typeof err === "object" ? (err as { code?: unknown }).code : err;
  return typeof code === "string" ? code : "GDDY_ERROR";
}

const HTTP_ERROR = /^HTTP error (\d{3})\b/;

/** Reads the status from gddy's stderr error document (`error.message` starting "HTTP error 403"). */
export function httpStatusFromStderr(stderr: string | undefined): number | undefined {
  if (!stderr) return undefined;
  let parsed: unknown;
  try {
    parsed = parseStdoutJson(stderr);
  } catch {
    return undefined;
  }
  const err = typeof parsed === "object" && parsed !== null ? (parsed as { error?: unknown }).error : undefined;
  const message = typeof err === "object" && err !== null ? (err as { message?: unknown }).message : undefined;
  const match = typeof message === "string" ? HTTP_ERROR.exec(message) : null;
  return match ? Number(match[1]) : undefined;
}

export interface GddyOptions {
  /** Absolute path to a gddy-compatible binary (tests), or bare "gddy" (real; needs `live`). */
  bin: string;
  /** Explicit confirmation of a live run: the only way to reach the real platform. */
  live?: boolean;
  timeoutMs?: number;
  log?: DeployLog;
  exec?: ExecFn;
  env?: NodeJS.ProcessEnv;
}

export class Gddy {
  readonly bin: string;
  private readonly log: DeployLog;
  private readonly exec: ExecFn;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  constructor(opts: GddyOptions) {
    if (!opts.live && !isAbsolute(opts.bin)) {
      throw new DeployError("LIVE_NOT_CONFIRMED", "refusing to run the real gddy without an explicit live confirmation");
    }
    this.bin = opts.bin;
    this.log = opts.log ?? stdoutLog;
    this.exec = opts.exec ?? defaultExec;
    this.env = opts.env ?? process.env;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** `label` is the only thing logged: argv values (ids, paths, names) stay out of every log line. */
  async call(label: string, argv: string[], timeoutMs = this.timeoutMs): Promise<unknown> {
    const res = await this.exec(this.bin, argv, { timeout: timeoutMs, maxBuffer: MAX_BUFFER, env: this.env });
    if (res.killed) return this.fail(label, "GDDY_TIMEOUT", `gddy ${label} timed out`);
    let parsed: unknown;
    try {
      parsed = parseStdoutJson(res.stdout);
    } catch {
      const httpStatus = res.failed ? httpStatusFromStderr(res.stderr) : undefined;
      return this.fail(label, res.failed ? "GDDY_FAILED" : "GDDY_NO_JSON", `gddy ${label} gave no usable JSON`, httpStatus);
    }
    const code = errorCodeOf(parsed) ?? (res.failed ? "GDDY_FAILED" : null);
    if (code !== null) return this.fail(label, code, `gddy ${label} failed: ${code}`);
    this.log({ event: "gddy", label, ok: true });
    return parsed;
  }

  private fail(label: string, code: string, message: string, httpStatus?: number): never {
    this.log(httpStatus === undefined ? { event: "gddy", label, ok: false, code } : { event: "gddy", label, ok: false, code, httpStatus });
    throw new DeployError(code, message, 500, httpStatus);
  }
}
