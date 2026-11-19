import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express, { type Express, type RequestHandler } from "express";
import { build } from "esbuild";
import { ClaudeClient } from "./claude/client.js";
import { loadRuntimeEnv } from "./claude/env.js";
import { createApp } from "./routes/app.js";
import { DEFAULT_STORE_ROOT, FsStore } from "./store/fsStore.js";
import { pageShell, type PageName } from "./views/layout.js";

/** The launcher is local-only: it binds to loopback and nothing else (CLAUDE.md, 04 §8). */
export const LAUNCHER_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4321;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_SRC = path.resolve(HERE, "../../../packages/ui/src");
const PUBLIC_DIR = path.resolve(HERE, "../public");
const CLIENT_DIR = path.join(HERE, "views/client");

const PAGES: { route: string; name: PageName }[] = [
  { route: "/", name: "describe" },
  { route: "/rules", name: "rules" },
  { route: "/rehearsal", name: "rehearsal" },
  { route: "/launch", name: "launch" },
];

/** No inline script or style, no third-party origin: the pages work offline and under a strict CSP. */
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  next();
};

/** Refuses any Host that is not loopback, so a DNS-rebinding page cannot talk to the launcher. */
function hostGuard(port: number): RequestHandler {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return (req, res, next) => {
    if (allowed.has(String(req.headers.host))) return next();
    res.status(421).type("text/plain").send("Wrong host");
  };
}

/** Bundles each page script (and the shared @agentdoor/ui code) in memory; no build step to run. */
async function bundleClients(): Promise<Map<string, string>> {
  const names = PAGES.map((p) => p.name);
  const out = await build({
    entryPoints: Object.fromEntries(names.map((n) => [n, path.join(CLIENT_DIR, `${n}.ts`)])),
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    outdir: "/virtual",
    splitting: false,
    logLevel: "silent",
  });
  return new Map(out.outputFiles.map((f) => [path.basename(f.path), f.text]));
}

export interface LauncherOptions {
  port?: number;
  storeRoot?: string;
  client?: ClaudeClient;
}

export async function createLauncher(opts: LauncherOptions = {}): Promise<{ app: Express; port: number }> {
  const port = opts.port ?? Number(process.env.AGENTDOOR_LAUNCHER_PORT ?? DEFAULT_PORT);
  const bundles = await bundleClients();
  const client = opts.client ?? new ClaudeClient();
  if (client.mode !== "replay") loadRuntimeEnv(); // replay never needs (or reads) a key
  const store = new FsStore(opts.storeRoot ?? process.env.AGENTDOOR_STORE_DIR ?? DEFAULT_STORE_ROOT);

  const app = express();
  app.disable("x-powered-by");
  app.use(hostGuard(port), securityHeaders);
  for (const file of ["tokens.css", "ui.css"])
    app.get(`/assets/${file}`, (_req, res) => res.type("text/css").send(readFileSync(path.join(UI_SRC, file), "utf8")));
  for (const [file, code] of bundles) app.get(`/assets/${file}`, (_req, res) => res.type("text/javascript").send(code));
  app.use("/assets", express.static(PUBLIC_DIR, { fallthrough: false, index: false }));
  for (const p of PAGES) app.get(p.route, (_req, res) => res.type("html").send(pageShell(p.name).value));
  app.use(createApp({ client, store }));
  return { app, port };
}

export async function startLauncher(opts: LauncherOptions = {}): Promise<Server> {
  const { app, port } = await createLauncher(opts);
  return new Promise((resolve) => {
    const server = app.listen(port, LAUNCHER_HOST, () => resolve(server));
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const server = await startLauncher();
  console.log(`AgentDoor launcher: http://${LAUNCHER_HOST}:${(server.address() as { port: number }).port}  (LLM mode: ${process.env.AGENTDOOR_LLM_MODE ?? "replay"})`);
}
