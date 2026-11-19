import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME, cmd, type Cmd } from "./commands.js";
import { DeployError } from "./errors.js";
import type { Gddy } from "./gddy.js";
import { stdoutLog, type DeployLog } from "./log.js";
import { pack, type PackOptions, type PackResult } from "./pack.js";
import { applySecrets, ensureSecretFiles, readSigningPublicKey, secretNames, type EnsureSecretsInput, type Variant } from "./secrets.js";
import { readHealth, smoke, type FetchFn } from "./smoke.js";
import { checkGate } from "./gate.js";

const POLL_START_MS = 2_000;
const POLL_CAP_MS = 15_000;
const POLL_MAX_MS = 300_000;
const STATE_MODE = 0o600;
const PRIVATE_NAMES = ["QUOTE_SIGNING_PRIVATE_KEY", "SESSION_SECRET", "OWNER_TOKEN_HASH"];
const DONE = new Set(["COMPLETED", "SUCCEEDED", "SUCCESS", "DONE"]);
const FAILED = new Set(["FAILED", "ERROR", "CANCELLED"]);

export interface DeployOptions {
  repoRoot: string;
  gddy: Gddy;
  /** Where the gddy binary came from, passed to set-secrets so it resolves the same one. */
  gddyBin: string;
  bundleDir: string;
  /** Public hostname once attached (e.g. agentdoor.shop). Without it the PUBLISH url from `app get` is used. */
  domain?: string;
  recipientEmail?: string;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => number;
  log?: DeployLog;
  /** Test seams. */
  lockfile?: PackOptions["lockfile"];
  validatorPath?: string;
}

export interface DeployResult {
  appId: string;
  policyHash: string;
  baseUrl: string;
  steps: Record<string, "done" | "skipped">;
  /** Plain owner tokens for secrets files created in this run: show once, never store. */
  ownerTokens: Partial<Record<Variant, string>>;
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (typeof v === "object" && v !== null ? (v as Json) : {});
const dataOf = (res: unknown): Json => asObj(asObj(res).data);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function arrayAt(res: unknown, keys: string[]): Json[] {
  const data = asObj(res).data;
  const list = Array.isArray(data) ? data : keys.map((k) => asObj(data)[k]).find(Array.isArray);
  return Array.isArray(list) ? list.map(asObj) : [];
}

export async function deploy(opts: DeployOptions): Promise<DeployResult> {
  return new Deployer(opts).run();
}

class Deployer {
  private readonly stateDir: string;
  private readonly log: DeployLog;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetchFn: FetchFn;
  private readonly steps: DeployResult["steps"] = {};
  private appId = "";

  constructor(private readonly o: DeployOptions) {
    this.stateDir = join(o.repoRoot, ".agentdoor");
    this.log = o.log ?? stdoutLog;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.fetchFn = o.fetchFn ?? ((url, init) => fetch(url, init));
  }

  private mark(step: string, status: "done" | "skipped"): void {
    this.steps[step] = status;
    this.log({ event: "step", step, status });
  }

  private call(c: Cmd): Promise<unknown> {
    return this.o.gddy.call(c.label, c.argv);
  }

  async run(): Promise<DeployResult> {
    const trusted = readSigningPublicKey(this.stateDir);
    // Gate first, from disk, before any gddy call or secret file is touched (U-GATE-3).
    const gate = checkGate(this.o.bundleDir, trusted);
    const publicHost = this.o.domain ? `https://${this.o.domain}` : null;
    const packed = await this.pack(trusted);
    this.mark("pack", "done");
    await this.ensureApp();
    await this.checkSubscription();
    const uploaded = await this.upload(packed);
    const baseUrl = publicHost ?? (await this.publishUrl());
    const secrets = ensureSecretFiles(this.secretsInput(baseUrl));
    const changedPreview = await this.secrets("PREVIEW");
    await this.previewVerify(gate.policyHash, uploaded || changedPreview);
    await this.secrets("PUBLISH");
    await this.publish(gate.policyHash, baseUrl);
    await this.domainCheck();
    await smoke({ fetchFn: this.fetchFn, baseUrl, policy: gate.policy, policyHash: gate.policyHash, nowMs: (this.o.nowMs ?? Date.now)() });
    this.mark("smoke", "done");
    return { appId: this.appId, policyHash: gate.policyHash, baseUrl, steps: this.steps, ownerTokens: secrets.ownerTokens };
  }

  private secretsInput(baseUrl: string): EnsureSecretsInput {
    return {
      stateDir: this.stateDir,
      recipientEmail: this.o.recipientEmail,
      publicBaseUrl: { PREVIEW: baseUrl, PUBLISH: baseUrl },
    };
  }

  private async pack(trusted: string): Promise<PackResult> {
    return pack({
      repoRoot: this.o.repoRoot,
      bundleDir: this.o.bundleDir,
      outDir: join(this.o.repoRoot, "out"),
      trustedPublicKey: trusted,
      forbiddenValues: this.existingSecretValues(),
      lockfile: this.o.lockfile,
      validatorPath: this.o.validatorPath,
    });
  }

  private existingSecretValues(): string[] {
    const out: string[] = [];
    for (const v of ["PREVIEW", "PUBLISH"] as const) {
      const f = join(this.stateDir, "secrets", `${v.toLowerCase()}.json`);
      if (!existsSync(f)) continue;
      const file = JSON.parse(readFileSync(f, "utf8")) as Record<string, string>;
      // Public values (public key, base URL, recipient) legitimately appear in the bundle.
      for (const name of PRIVATE_NAMES) if (file[name]) out.push(file[name]);
    }
    return out;
  }

  // --- app: the only place `app create` can happen ---------------------------------------------

  private readState(): string | null {
    const f = join(this.stateDir, "deploy.json");
    if (!existsSync(f)) return null;
    return str(asObj(JSON.parse(readFileSync(f, "utf8"))).appId) ?? null;
  }

  private writeState(appId: string): void {
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const tmp = join(this.stateDir, "deploy.json.tmp");
    writeFileSync(tmp, JSON.stringify({ appId, name: APP_NAME }), { mode: STATE_MODE });
    renameSync(tmp, join(this.stateDir, "deploy.json"));
  }

  private async ensureApp(): Promise<void> {
    const saved = this.readState();
    if (saved) {
      // A state file means the app exists: if gddy cannot find it, stop rather than create a second one.
      await this.call(cmd.getApp(saved));
      this.appId = saved;
      return this.mark("app", "skipped");
    }
    const existing = await this.findApp();
    if (existing) {
      this.appId = existing;
      this.writeState(existing);
      return this.mark("app", "skipped");
    }
    const created = dataOf(await this.call(cmd.createApp()));
    const op = await this.waitOperation(str(created.operationId));
    const id = str(asObj(op.app).id);
    if (!id) throw new DeployError("APP_CREATE_FAILED", "app create finished without an app id");
    this.appId = id;
    this.writeState(id);
    this.mark("app", "done");
  }

  private async findApp(): Promise<string | null> {
    const apps = arrayAt(await this.call(cmd.listApps()), ["apps", "items"]);
    return str(apps.find((a) => a.name === APP_NAME)?.id) ?? null;
  }

  private async checkSubscription(): Promise<void> {
    // Attaching consumes the paid slot, so it is an owner action, never done by this script.
    await this.call(cmd.getSubscription(this.appId));
    this.mark("subscription", "skipped");
  }

  // --- polling -----------------------------------------------------------------------------------

  private async poll<T>(what: string, probe: () => Promise<T | undefined>): Promise<T> {
    let waited = 0;
    let delay = POLL_START_MS;
    for (;;) {
      const got = await probe();
      if (got !== undefined) return got;
      if (waited >= POLL_MAX_MS) throw new DeployError("POLL_TIMEOUT", `${what} did not finish in time`);
      await this.sleep(delay);
      waited += delay;
      delay = Math.min(delay * 2, POLL_CAP_MS);
    }
  }

  private async waitOperation(opId: string | undefined): Promise<Json> {
    if (!opId) throw new DeployError("GDDY_BAD_RESPONSE", "gddy returned no operation id");
    return this.poll("operation", async () => {
      const data = dataOf(await this.call(cmd.getOperation(opId)));
      const status = String(data.status ?? "").toUpperCase();
      if (FAILED.has(status)) throw new DeployError("OPERATION_FAILED", `operation ended ${status}`);
      return DONE.has(status) ? data : undefined;
    });
  }

  // --- upload -------------------------------------------------------------------------------------

  /** Returns true when an upload happened in this run. */
  private async upload(packed: PackResult): Promise<boolean> {
    const fileName = `shop-${packed.artifactId}.zip`;
    const imports = arrayAt(await this.call(cmd.listImports(this.appId)), ["imports", "items"]);
    const same = imports.find((i) => i.fileName === fileName && DONE.has(String(i.status).toUpperCase()));
    if (same) {
      this.mark("upload", "skipped");
      return false;
    }
    const started = dataOf(await this.call(cmd.upload(this.appId, packed.zipPath)));
    const importId = str(started.importId);
    if (!importId) throw new DeployError("GDDY_BAD_RESPONSE", "upload returned no import id");
    await this.poll("import", async () => {
      const status = String(dataOf(await this.call(cmd.getImport(this.appId, importId))).status ?? "").toUpperCase();
      if (FAILED.has(status)) throw new DeployError("IMPORT_FAILED", `import ended ${status}`);
      return DONE.has(status) ? true : undefined;
    });
    this.mark("upload", "done");
    return true;
  }

  private async publishUrl(): Promise<string> {
    const urls = asObj(dataOf(await this.call(cmd.getApp(this.appId))).urls);
    const host = str(urls.publish);
    if (!host) throw new DeployError("GDDY_BAD_RESPONSE", "app has no publish url");
    return host.startsWith("http") ? host : `https://${host}`;
  }

  // --- secrets ------------------------------------------------------------------------------------

  /** Names are compared, never values. Returns true when anything was (re)applied. */
  private async secrets(variant: Variant): Promise<boolean> {
    const present = new Set(
      arrayAt(await this.call(cmd.listSecrets(this.appId, variant)), ["secrets", "items"]).map((s) => str(s.name)),
    );
    const wanted = secretNames(this.stateDir, variant);
    if (wanted.every((n) => present.has(n))) {
      this.mark(`secrets-${variant.toLowerCase()}`, "skipped");
      return false;
    }
    await applySecrets({ repoRoot: this.o.repoRoot, stateDir: this.stateDir, variant, gddyBin: this.o.gddyBin });
    this.log({ event: "secrets", variant, names: wanted.length });
    this.mark(`secrets-${variant.toLowerCase()}`, "done");
    return true;
  }

  // --- preview ------------------------------------------------------------------------------------

  private async bootSeen(hash: string): Promise<boolean> {
    const res = await this.call(cmd.logs(this.appId, "PREVIEW"));
    const lines = arrayAt(res, ["logs", "items", "lines"]);
    const texts = lines.length > 0 ? lines.map((l) => JSON.stringify(l)) : [JSON.stringify(asObj(res).data ?? "")];
    const unescaped = texts.map((t) => t.replaceAll('\\"', '"'));
    return unescaped.some((t) => t.includes('"event":"boot"') && t.includes('"launched":true') && t.includes(`"policyHash":"${hash}"`));
  }

  /** Upload + secrets only reach the running preview after a restart; then wait for the boot line. */
  private async previewVerify(hash: string, changed: boolean): Promise<void> {
    if (!changed && (await this.bootSeen(hash))) return this.mark("preview", "skipped");
    if (changed) await this.call(cmd.restart(this.appId, "PREVIEW"));
    await this.poll("preview boot", async () => ((await this.bootSeen(hash)) ? true : undefined));
    this.mark("preview", "done");
  }

  // --- publish, domain ---------------------------------------------------------------------------

  private async publish(hash: string, baseUrl: string): Promise<void> {
    const live = await readHealth(this.fetchFn, baseUrl);
    if (live?.launched && live.policyHash === hash) return this.mark("publish", "skipped");
    const started = dataOf(await this.call(cmd.publish(this.appId)));
    const opId = str(started.operationId);
    if (opId) await this.waitOperation(opId);
    await this.poll("public health", async () => {
      const h = await readHealth(this.fetchFn, baseUrl);
      return h?.launched && h.policyHash === hash ? true : undefined;
    });
    this.mark("publish", "done");
  }

  private async domainCheck(): Promise<void> {
    if (!this.o.domain) return this.mark("domain", "skipped");
    // Attaching a domain is a once-only owner action (03 §5.5 rule 3); here we only verify it.
    const domains = arrayAt(await this.call(cmd.listDomains(this.appId)), ["domains", "items"]);
    const active = domains.some((d) => (d.domain ?? d.name) === this.o.domain && String(d.status).toUpperCase() === "ACTIVE");
    if (!active) throw new DeployError("DOMAIN_NOT_ACTIVE", "the custom domain is not attached and ACTIVE on the app");
    this.mark("domain", "done");
  }
}
