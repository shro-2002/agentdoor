import type { RequestHandler } from "express";
import type { ShopConfig } from "../config.js";
import { sendError } from "../http/envelope.js";

const WWW = "www.";

/** apex <-> www: both names serve the app directly (no redirect), so a form can be posted from either. */
function wwwCounterpart(url: URL): string {
  const twin = new URL(url.origin);
  twin.hostname = url.hostname.startsWith(WWW) ? url.hostname.slice(WWW.length) : WWW + url.hostname;
  return twin.origin;
}

/** The custom domain (apex and www) and the platform PREFIX URL all reach this app (T01). */
export function allowedOrigins(config: Pick<ShopConfig, "publicBaseUrl" | "platformBaseUrl">): Set<string> {
  const publicUrl = new URL(config.publicBaseUrl);
  const origins = new Set([publicUrl.origin, wwwCounterpart(publicUrl)]);
  if (config.platformBaseUrl) origins.add(new URL(config.platformBaseUrl).origin);
  return origins;
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
