import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyLaunchRecord, type SignedLaunchRecord } from "@agentdoor/core";
import { checkGate } from "../../src/deploy/gate.js";
import { createApp } from "../../src/routes/app.js";
import { newStore, readTranscript, replayClient } from "../compile/helpers.js";
import { pinClock, tmpDir, writeKeys } from "./helpers.js";

beforeEach(() => pinClock());
afterEach(() => vi.unstubAllEnvs());

const servers: { close: () => void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

type Json = any;

async function boot() {
  const dir = tmpDir();
  const paths = { bundleDir: path.join(dir, "bundle"), secretsDir: path.join(dir, "secrets") };
  const keys = writeKeys(paths.secretsDir);
  const app = createApp({ store: newStore(), client: replayClient(), paths });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (method: string, url: string, body?: unknown): Promise<{ status: number; json: Json }> => {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const rehearse = async (id: string): Promise<Json> => {
    const started = await send("POST", `/api/session/${id}/rehearse`);
    expect(started.status).toBe(202);
    for (let i = 0; i < 200; i++) {
      const polled = await send("GET", `/api/runs/${started.json.data.runId}`);
      if (polled.json.data.status !== "running") return polled.json.data;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("rehearsal never finished");
  };
  return { send, rehearse, paths, keys };
}

describe("T08 acceptance: seeded-leaky -> gaps -> typed fixes -> re-run -> signed launch record (replay, no Claude)", () => {
  it("runs the whole launch flow over the launcher routes", async () => {
    const { send, rehearse, paths, keys } = await boot();
    const created = await send("POST", "/api/session", { language: "en", transcript: readTranscript("seeded-leaky"), fixtureKey: "seeded-leaky" });
    const id = created.json.data.sessionId as string;
    expect((await send("POST", `/api/session/${id}/compile`)).status).toBe(200);

    // 1. the leaky policy: at least 3 critical gaps, and the planted leaks are among them
    const first = await rehearse(id);
    expect(first.status).toBe("done");
    const critical = first.result.gaps.filter((g: Json) => g.severity === "critical");
    expect(critical.length).toBeGreaterThanOrEqual(3);
    const codes = new Set(first.result.gaps.map((g: Json) => g.code));
    for (const code of ["NO_CAPACITY_LIMIT", "UNLISTED_AREA_POLICY", "LOW_CONFIDENCE_SOURCE"]) expect(codes.has(code)).toBe(true);
    expect(first.result.summary.criticalOpen).toBeGreaterThanOrEqual(3);
    const card = first.cards.find((c: Json) => c.code === "NO_CAPACITY_LIMIT");
    expect(card.fixes.length).toBeGreaterThan(1);
    expect((await send("GET", `/api/session/${id}/gate`)).json.data.canLaunch).toBe(false);
    expect((await send("POST", `/api/session/${id}/launch`, { consent: true })).status).toBe(409);

    // 2. the owner approves what is clearly stated, then fixes the rest with typed choices
    const bulk = await send("POST", `/api/session/${id}/rules/approve-high`);
    expect(bulk.status).toBe(200);
    let run = await rehearse(id);
    for (let round = 0; round < 6 && run.result.summary.criticalOpen > 0; round++) {
      for (const gap of run.result.gaps.filter((g: Json) => g.severity === "critical" && !g.dismissed)) {
        const cardFor = run.cards.find((c: Json) => c.gapId === gap.id);
        const choice = gap.code === "SCENARIO_UNHANDLED" ? "dismiss" : cardFor.fixes[0].choice;
        const value = cardFor.fixes.find((f: Json) => f.choice === choice).needsValue ? 10 : undefined;
        await send("POST", `/api/session/${id}/gaps/${encodeURIComponent(gap.id)}/fix`, { choice, value });
      }
      run = await rehearse(id);
    }

    // 3. no critical gap left, the gate opens, consent signs the record
    expect(run.result.summary.criticalOpen).toBe(0);
    const gate = await send("GET", `/api/session/${id}/gate`);
    expect(gate.json.data).toMatchObject({ canLaunch: true });
    expect((await send("POST", `/api/session/${id}/launch`, { consent: false })).status).toBe(400);
    const launched = await send("POST", `/api/session/${id}/launch`, { consent: true });
    expect(launched.status).toBe(200);

    const signed = JSON.parse(readFileSync(path.join(paths.bundleDir, "launch-record.json"), "utf8")) as SignedLaunchRecord;
    expect(verifyLaunchRecord(signed, keys.publicKey)).toBe(true);
    expect(signed.record.rehearsal.criticalOpen).toBe(0);
    expect(signed.record.rehearsal.gapsFound.filter((g) => g.severity === "critical").length).toBeGreaterThanOrEqual(3);
    expect(checkGate(paths.bundleDir, keys.publicKey).policyHash).toBe(signed.record.policyHash);
  }, 60_000);

  it("reports unknown sessions, runs and gaps in the shared envelope", async () => {
    const { send } = await boot();
    expect((await send("GET", "/api/runs/r_000000000000")).status).toBe(404);
    expect((await send("GET", "/api/session/s_000000000000/gate")).json.error.code).toBe("SESSION_NOT_FOUND");
    const created = await send("POST", "/api/session", { language: "en", transcript: readTranscript("seeded-leaky"), fixtureKey: "seeded-leaky" });
    const id = created.json.data.sessionId as string;
    await send("POST", `/api/session/${id}/compile`);
    expect((await send("POST", `/api/session/${id}/gaps/NOPE/fix`, { choice: "x" })).json.error.code).toBe("GAP_NOT_FOUND");
    expect((await send("POST", `/api/session/${id}/rules/${encodeURIComponent("no.such")}/approve`)).status).toBe(404);
  });
});
