import { join } from "node:path";
import { createApp } from "./app.js";
import { loadConfigOrExit } from "./config.js";
import { loadLaunchState } from "./db/launch-state.js";
import { migrateOrExit } from "./db/migrations.js";
import { createPool } from "./db/pool.js";
import { stdoutLogger } from "./log.js";

/** `pack` (T09) ships the policy and signed launch record here; override for local runs. */
const bundleDir = process.env.BUNDLE_DIR ?? join(process.cwd(), "bundle");

async function main(): Promise<void> {
  // Fail closed before listening: bad env or a broken schema must not serve (03 §5.4).
  const config = loadConfigOrExit();
  const pool = createPool(config.db);
  await migrateOrExit(pool);
  const launch = loadLaunchState(bundleDir, config.signingPublicKey);
  stdoutLogger(
    launch.launched
      ? { level: "info", event: "boot", launched: true, policyHash: launch.policyHash }
      : { level: "warn", event: "boot", launched: false, reason: launch.reason },
  );
  const app = createApp({ config, pool, launch });
  app.listen(config.port, () => stdoutLogger({ level: "info", event: "listening", port: config.port }));
}

process.on("unhandledRejection", (reason) => {
  stdoutLogger({ level: "error", event: "unhandled_rejection", message: String(reason) });
});

main().catch((err: unknown) => {
  stdoutLogger({ level: "error", event: "boot_failed", message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
