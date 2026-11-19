import type { Pool } from "mysql2/promise";
import type { ShopConfig } from "../config.js";
import type { LaunchState } from "../db/launch-state.js";
import type { Logger } from "../log.js";

/** Everything the quote and order services need. Routes (REST and MCP) share one instance. */
export interface ServiceContext {
  config: ShopConfig;
  pool: Pool;
  launch: LaunchState;
  /** Injected clock (ms since epoch); the only time source in the shop. */
  now: () => number;
  log: Logger;
}
