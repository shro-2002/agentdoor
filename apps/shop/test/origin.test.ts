import { describe, expect, it } from "vitest";
import { allowedOrigins } from "../src/security/origin.js";

const origins = (publicBaseUrl: string, platformBaseUrl: string | null = null) =>
  [...allowedOrigins({ publicBaseUrl, platformBaseUrl })].sort();

describe("allowedOrigins", () => {
  it("allows the www counterpart of an apex PUBLIC_BASE_URL (both serve the app)", () => {
    expect(origins("https://agentdoor.shop")).toEqual(["https://agentdoor.shop", "https://www.agentdoor.shop"]);
  });

  it("allows the apex counterpart of a www PUBLIC_BASE_URL", () => {
    expect(origins("https://www.agentdoor.shop/")).toEqual(["https://agentdoor.shop", "https://www.agentdoor.shop"]);
  });

  it("keeps scheme and port, adds nothing for other hosts, and keeps the platform URL as is", () => {
    expect(origins("http://localhost:3000")).toEqual(["http://localhost:3000", "http://www.localhost:3000"]);
    const all = origins("https://agentdoor.shop", "https://abc123.airoapp.ai");
    expect(all).toContain("https://abc123.airoapp.ai");
    expect(all).not.toContain("https://www.abc123.airoapp.ai");
    expect(all).not.toContain("http://agentdoor.shop");
    expect(all).not.toContain("https://evil.agentdoor.shop");
  });
});
