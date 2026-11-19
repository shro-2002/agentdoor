#!/usr/bin/env node
// FAKE gddy for tests. Stateful (FAKE_GDDY_STATE json file), records every argv, prints an update
// notice before the JSON like the real CLI. It never touches the network or any real account.
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const statePath = process.env.FAKE_GDDY_STATE;
const argv = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const save = () => writeFileSync(statePath, JSON.stringify(state));
const flag = (name) => argv[argv.indexOf(name) + 1];
const param = (key) => argv.find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1);

const out = (data, code = 0) => {
  console.log("A new gddy version is available: run `gddy update`"); // stdout noise before the JSON
  console.error("stderr notice {not json");
  console.log(JSON.stringify({ data }));
  process.exit(code);
};
const fail = (code) => {
  console.log("notice line");
  console.log(JSON.stringify({ error: { code, message: "boom" } }));
  process.exit(1);
};

state.calls.push(argv);
const key = argv.slice(0, 3).join(" ");
const failKey = state.failOnce.find((k) => argv.join(" ").startsWith(k));
if (failKey) {
  state.failOnce = state.failOnce.filter((k) => k !== failKey);
  save();
  fail("INJECTED_FAILURE");
}

function secretsCall() {
  const variant = param("variant");
  const file = flag("--file");
  const mode = statSync(file).mode & 0o777;
  const patch = JSON.parse(readFileSync(file, "utf8"));
  state.secretBodies.push({ variant, mode, file, patch, contentType: argv.includes("Content-Type: application/json-patch+json") });
  state.secrets[variant] = [...new Set([...state.secrets[variant], ...patch.map((p) => p.path.slice(1))])];
  save();
  out({ updated: patch.length });
}

const handlers = {
  "hosting app list": () => out({ apps: state.apps }),
  "hosting app create": () => {
    state.created += 1;
    state.apps.push({ id: "APP-NEW", name: "agentdoor-shop" });
    save();
    out({ operationId: "op-create" });
  },
  "hosting operation get": () => out(flag("--operation-id") === "op-create" ? { status: "COMPLETED", app: { id: "APP-NEW" } } : { status: "COMPLETED" }),
  "hosting app get": () => {
    if (!state.apps.some((a) => a.id === flag("--app-id"))) fail("NOT_FOUND");
    out({ urls: { publish: "fake-app.airoapp.ai" } });
  },
  "hosting subscription get": () => (state.subscription ? out({ attached: true }) : fail("SUBSCRIPTION_NOT_ATTACHED")),
  "hosting source upload": () => {
    const importId = `imp-${state.imports.length + 1}`;
    state.imports.push({ importId, fileName: basename(flag("--file")), status: "COMPLETED" });
    save();
    out({ importId });
  },
  "hosting source status": () => {
    if (!flag("--app-id") || !state.imports.some((i) => i.importId === flag("--import-id"))) fail("NOT_FOUND");
    out({ status: "COMPLETED" });
  },
  "hosting secret list": () => out({ secrets: (state.secrets[flag("--variant")] ?? []).map((name) => ({ name })) }),
  "hosting app restart": () => {
    state.restarts.push(flag("--variant"));
    if (flag("--variant") === "PREVIEW") state.previewBoot = true;
    save();
    out({ ok: true });
  },
  "hosting log list": () =>
    out({ logs: state.previewBoot ? [{ message: JSON.stringify({ event: "boot", launched: true, policyHash: state.hash }) }] : [] }),
  "hosting deployment publish": () => {
    state.published = true;
    save();
    out({ operationId: "op-publish" });
  },
  "hosting domain list": () => out({ domains: state.domains }),
  "api call -X": secretsCall,
};

const handler = handlers[key];
save();
if (!handler) {
  // Like the real CLI: unknown command, error on stderr, non-zero exit.
  console.error(`error: unknown command "${argv.slice(0, 3).join(" ")}"`);
  process.exit(1);
}
handler();
