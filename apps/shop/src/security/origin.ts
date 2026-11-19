import type { RequestHandler } from "express";
import type { ShopConfig } from "../config.js";
import { sendError } from "../http/envelope.js";

/** The custom domain and the platform PREFIX URL both reach this app (T01). */
export function allowedOrigins(config: Pick<ShopConfig, "publicBaseUrl" | "platformBaseUrl">): Set<string> {
  const urls = [config.publicBaseUrl, config.platformBaseUrl].filter((u): u is string => !!u);
  return new Set(urls.map((u) => new URL(u).origin));
}

/**
 * CSRF defence for cookie-authenticated and form routes (with SameSite=Strict on the cookie).
 * A missing Origin is refused: every browser sends one on a cross-site or same-site form POST.
 */
export function requireSameOrigin(config: Pick<ShopConfig, "publicBaseUrl" | "platformBaseUrl">): RequestHandler {
  const allowed = allowedOrigins(config);
  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && allowed.has(origin)) {
      next();
      return;
    }
    sendError(req, res, "FORBIDDEN");
  };
}
