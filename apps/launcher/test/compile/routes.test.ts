import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/routes/app.js";
import { FIXTURES, newStore, readTranscript, replayClient } from "./helpers.js";

const servers: { close: () => void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function boot() {
  const store = newStore();
  const app = createApp({ store, client: replayClient() });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { send, store };
}

describe("launcher session routes (04 §8)", () => {
  it("session -> compile -> answers -> second round refused, all in the shared envelope", async () => {
    const { send, store } = await boot();
    const created = await send("POST", "/api/session", {
      language: "en",
      transcript: readTranscript("seeded-leaky"),
      fixtureKey: "seeded-leaky",
    });
    expect(created.status).toBe(201);
    expect(created.json.error).toBeNull();
    expect(created.json.meta.requestId).toEqual(expect.any(String));
    const id = created.json.data.sessionId as string;

    const compiled = await send("POST", `/api/session/${id}/compile`);
    expect(compiled.status).toBe(200);
    expect(compiled.json.data.version).toBe(1);
    expect(compiled.json.data.validation).toMatchObject({ ok: true });
    const questions = compiled.json.data.compileResult.questions as { id: string; path: string }[];
    expect(questions.length).toBeGreaterThanOrEqual(1);

    const table = JSON.parse(readFileSync(path.join(FIXTURES, "answers", "seeded-leaky.json"), "utf8")) as Record<string, string>;
    const answers = questions.flatMap((q) => (table[q.path] ? [{ questionId: q.id, text: table[q.path]! }] : []));
    const answered = await send("POST", `/api/session/${id}/answers`, { answers });
    expect(answered.status).toBe(200);
    expect(answered.json.data.version).toBe(2);
    expect(store.latestVersion(id)).toBe(2);

    const again = await send("POST", `/api/session/${id}/answers`, { answers });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ data: null, error: { code: "CLARIFY_LIMIT" } });
  });

  it("validates input strictly: size limit, unknown keys, bad ids, unknown session", async () => {
    const { send } = await boot();
    expect((await send("POST", "/api/session", { language: "en", transcript: "x".repeat(6001) })).status).toBe(400);
    expect((await send("POST", "/api/session", { language: "en", transcript: "hi", extra: 1 })).status).toBe(400);
    expect((await send("POST", "/api/session", { language: "fr", transcript: "hi" })).status).toBe(400);
    expect((await send("POST", "/api/session", { language: "en", transcript: "hi", fixtureKey: "../x" })).status).toBe(400);
    const bad = await send("POST", "/api/session/..%2F..%2Fetc/compile");
    expect(bad.status).toBe(404);
    expect(bad.json.error.code).toBe("SESSION_NOT_FOUND");
    expect((await send("POST", "/api/session/s_aaaaaaaaaaaa/compile")).status).toBe(404);
  });

  it("a missing fixture is a clean 503 envelope without a stack trace", async () => {
    const { send } = await boot();
    const created = await send("POST", "/api/session", { language: "en", transcript: readTranscript("en"), fixtureKey: "no-such-fixture" });
    const res = await send("POST", `/api/session/${created.json.data.sessionId}/compile`);
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("FIXTURE_MISSING");
    expect(JSON.stringify(res.json)).not.toMatch(/\bat .*\.ts/);
  });

  it("GET /api/usage reports spend (replay is free)", async () => {
    const { send } = await boot();
    const res = await send("GET", "/api/usage");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ totalUsd: 0 });
  });
});
