// Usage: AGENTDOOR_LIVE_DEPLOY=I-CONFIRM-LIVE-DEPLOY npx tsx scripts/deploy.ts --live [--domain agentdoor.shop] [--bundle bundle]
// Linear, rerunnable deploy of the shop to the single GoDaddy app. It talks to the REAL gddy only
// when BOTH the --live flag and the env confirmation are present; otherwise it exits before doing anything.
import { join } from "node:path";
import { deploy } from "../apps/launcher/src/deploy/deploy.js";
import { DeployError } from "../apps/launcher/src/deploy/errors.js";
import { Gddy } from "../apps/launcher/src/deploy/gddy.js";

const LIVE_ENV_VALUE = "I-CONFIRM-LIVE-DEPLOY";
const EXIT_REFUSED = 2;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function liveConfirmed(args: string[], env: NodeJS.ProcessEnv): boolean {
  return args.includes("--live") && env.AGENTDOOR_LIVE_DEPLOY === LIVE_ENV_VALUE;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!liveConfirmed(args, process.env)) {
    console.error("Refusing to deploy: a live run needs the --live flag and AGENTDOOR_LIVE_DEPLOY=" + LIVE_ENV_VALUE + ".");
    process.exit(EXIT_REFUSED);
  }
  const repoRoot = process.cwd();
  const result = await deploy({
    repoRoot,
    gddy: new Gddy({ bin: "gddy", live: true }),
    gddyBin: "gddy",
    bundleDir: join(repoRoot, flag(args, "--bundle") ?? "bundle"),
    domain: flag(args, "--domain"),
    recipientEmail: process.env.CONTACT_FORM_RECIPIENT_EMAIL,
  });
  console.log(JSON.stringify({ event: "deployed", baseUrl: result.baseUrl, policyHash: result.policyHash, steps: result.steps }));
  // Owner tokens are shown exactly once, on first creation of a secrets file, and are never stored.
  for (const [variant, token] of Object.entries(result.ownerTokens)) console.log(`${variant} owner token (shown once): ${token}`);
}

main().catch((err: unknown) => {
  const code = err instanceof DeployError ? err.code : "DEPLOY_FAILED";
  console.error(`deploy failed [${code}]: ${err instanceof Error ? err.message : "unknown error"}. Run again to continue.`);
  process.exit(1);
});
