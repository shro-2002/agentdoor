import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

/** 04 §4. No inline script or style: pages must work under this policy. */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];
const TRY_FRAME_SRC = "frame-src https://www.youtube-nocookie.com";
const HSTS_MAX_AGE_SECONDS = 15_552_000; // 180 days

/** requestId first, so even a header or parse failure is traceable. */
export const requestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
};

/** HSTS only when the public URL is HTTPS (the custom domain serves HTTPS since T01). */
export function securityHeaders(publicBaseUrl: string): RequestHandler {
  const hsts = publicBaseUrl.startsWith("https://");
  return (req, res, next) => {
    const csp = req.path.startsWith("/try") ? [...CSP_DIRECTIVES, TRY_FRAME_SRC] : CSP_DIRECTIVES;
    res.setHeader("Content-Security-Policy", csp.join("; "));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (hsts) res.setHeader("Strict-Transport-Security", `max-age=${HSTS_MAX_AGE_SECONDS}`);
    next();
  };
}
