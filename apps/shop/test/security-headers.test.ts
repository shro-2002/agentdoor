import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "../src/security/headers.js";

function headersFor(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => void (out[k] = v) } as unknown as Response;
  securityHeaders("https://shop.test")({ path } as Request, res, () => undefined);
  return out;
}

describe("SEC-5 the CSP lets no inline or eval script run", () => {
  it.each(["/", "/owner", "/try/rules"])("script execution is limited to the shop's own files on %s", (path) => {
    const csp = headersFor(path)["Content-Security-Policy"]!;
    const directives = Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d]));
    // No script-src of its own, so default-src 'self' governs scripts: nothing inline, nothing eval'd, no other origin.
    expect(directives["script-src"]).toBeUndefined();
    expect(directives["default-src"]).toBe("default-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(directives["frame-ancestors"]).toBe("frame-ancestors 'none'");
  });

  it("only /try may embed a frame (the demo video)", () => {
    expect(headersFor("/")["Content-Security-Policy"]).not.toContain("frame-src");
    expect(headersFor("/try")["Content-Security-Policy"]).toContain("frame-src https://www.youtube-nocookie.com");
  });
});

describe("the preview may be framed by this site only", () => {
  const ancestors = (path: string): string => /frame-ancestors [^;]+/.exec(headersFor(path)["Content-Security-Policy"]!)![0];

  it("/launch/p/* allows same-origin framing; every other page forbids framing", () => {
    expect(ancestors("/launch/p/" + "a".repeat(32))).toBe("frame-ancestors 'self'");
    expect(headersFor("/launch/p/" + "a".repeat(32))["X-Frame-Options"]).toBe("SAMEORIGIN");
    for (const path of ["/", "/launch", "/launch/w/" + "a".repeat(32) + "/storefront", "/order", "/owner", "/try"]) {
      expect(ancestors(path), path).toBe("frame-ancestors 'none'");
      expect(headersFor(path)["X-Frame-Options"], path).toBe("DENY");
    }
  });
});
