import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assetsRouter } from "../src/routes/assets.js";

describe("asset caching", () => {
  let server: ReturnType<express.Express["listen"]>;
  let base = "";
  beforeAll(async () => {
    const app = express().use(assetsRouter());
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("makes browsers revalidate stylesheets and scripts after a deploy", async () => {
    for (const file of ["workspace.css", "workspace.js"]) {
      const res = await fetch(`${base}/assets/${file}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });

  it("keeps a max-age on photos", async () => {
    const res = await fetch(`${base}/assets/photos/brownies.jpg`);
    expect(res.headers.get("cache-control")).toMatch(/max-age=\d+/);
  });
});
