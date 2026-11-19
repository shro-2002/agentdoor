import Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "mysql2/promise";
import { ClaudeClient, type AnthropicLike } from "../../../launcher/src/claude/client.js";
import { mysqlSpendGuard } from "./budget.js";
import type { WorkspaceConfig } from "./config.js";

/** A Claude call can take a minute or more; the job limit (3 minutes) is the real ceiling. */
const SDK_TIMEOUT_MS = 100_000;
/** A retried request could be billed twice, and the reservation assumes one attempt. */
const SDK_MAX_RETRIES = 0;

/** The key comes from the environment of this process only; it is never logged or put in an error. */
function liveSdk(cfg: WorkspaceConfig): AnthropicLike {
  return new Anthropic({ apiKey: cfg.apiKey ?? undefined, timeout: SDK_TIMEOUT_MS, maxRetries: SDK_MAX_RETRIES }) as unknown as AnthropicLike;
}

/**
 * The workspace's one Claude client. Mode is fixed to "live": there is no setting that makes the
 * deployed app answer from recorded fixtures (those exist only for the launcher's tests). Spend goes
 * through the MySQL budget, not the launcher's local usage file.
 */
export function createWorkspaceClient(pool: Pool, cfg: WorkspaceConfig): ClaudeClient {
  return new ClaudeClient({
    mode: "live",
    spendGuard: mysqlSpendGuard(pool, cfg),
    sdkFactory: cfg.sdkFactory ?? (() => liveSdk(cfg)),
  });
}

export const claudeConfigured = (cfg: WorkspaceConfig): boolean => Boolean(cfg.sdkFactory ?? cfg.apiKey);
