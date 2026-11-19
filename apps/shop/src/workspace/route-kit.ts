import type { CookieOptions, Request, RequestHandler, Response, Router } from "express";
import type { Pool } from "mysql2/promise";
import type { ShopConfig } from "../config.js";
import type { WorkspaceConfig } from "./config.js";
import type { WorkspaceJobs } from "./jobs.js";
import type { ViewCtx } from "./views/frame.js";

export const HTTP = { forbidden: 403, notFound: 404, conflict: 409, tooMany: 429, unavailable: 503, badRequest: 400 } as const;
export const HOUR_MS = 3_600_000;

/** What the route modules share: the database, the clock, the settings and the small response helpers. */
export interface RouteKit {
  router: Router;
  pool: Pool;
  now: () => number;
  config: ShopConfig;
  cfg: WorkspaceConfig;
  jobs: WorkspaceJobs;
  sameOrigin: RequestHandler;
  cookieBase: CookieOptions;
  send: (res: Response, markup: string, status?: number) => void;
  ipKey: (req: Request, label: string) => string;
  takeFlash: (req: Request, res: Response) => ViewCtx["flash"];
  /** Draft ids this browser owns. */
  owned: (req: Request) => string[];
}
