/**
 * `npm run export-demo [-- --session s_xxxxxxxxxxxx]`: writes bundle/try/session.json from the
 * launcher's `.agentdoor/` state (04 §9). Without --session it uses the newest session that has
 * a compile. Prints only counts and the output path, never content.
 */
import path from "node:path";
import { DEFAULT_STORE_ROOT, FsStore } from "../store/fsStore.js";
import { exportDemo } from "./exportDemo.js";
import { DEFAULT_GATE_PATHS } from "./gate.js";

function main(): void {
  const store = new FsStore(DEFAULT_STORE_ROOT);
  const flag = process.argv.indexOf("--session");
  const sessionId = flag >= 0 ? process.argv[flag + 1] : store.listSessions().find((s) => store.latestVersion(s.id) > 0)?.id;
  if (!sessionId) throw new Error("no launcher session found under .agentdoor/sessions (pass --session <id>)");
  const session = exportDemo({ store }, { sessionId });
  console.log(
    `export-demo: wrote ${path.join(DEFAULT_GATE_PATHS.bundleDir, "try", "session.json")} ` +
      `(${session.policyVersions.length} policy versions, ${session.scenarios.length} scenarios, ${session.gapFixes.length} gap fixes, ` +
      `${session.deployLog.length} deploy steps, $${session.usage.totalUsd.toFixed(4)} over ${session.usage.calls} Claude calls)`,
  );
}

try {
  main();
} catch (e) {
  const err = e as { code?: string; message?: string };
  console.error(`export-demo failed: ${err.code ?? "ERROR"}: ${err.message ?? "unknown"}`);
  process.exit(1);
}
