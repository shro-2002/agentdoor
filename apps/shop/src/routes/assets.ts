import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";

const ASSET_MAX_AGE = "10m";

/**
 * `pack` copies apps/shop/public to `<app>/public`, and the bundle runs from `<app>/dist`. In dev and
 * tests the source tree is used. The first folder that has tokens.css wins.
 */
export function findPublicDir(): string {
  const candidates = [
    process.env.PUBLIC_DIR,
    join(process.cwd(), "public"),
    fileURLToPath(new URL("../public", import.meta.url)),
    fileURLToPath(new URL("../../public", import.meta.url)),
  ];
  const found = candidates.find((dir) => dir && existsSync(join(dir, "tokens.css")));
  return found ?? candidates[3]!;
}

/** Static files only: CSS, the two small scripts and the icon. No directory listing, no dotfiles. */
export function assetsRouter(dir: string = findPublicDir()): Router {
  const router = Router();
  router.use(
    "/assets",
    express.static(dir, { index: false, dotfiles: "ignore", maxAge: ASSET_MAX_AGE, extensions: false }),
  );
  router.get("/favicon.ico", (_req, res) => res.redirect(301, "/assets/favicon.svg"));
  return router;
}
