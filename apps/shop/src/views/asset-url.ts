import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPublicDir } from "../routes/assets.js";

const HASH_CHARS = 10;
const cache = new Map<string, string>();

/**
 * `/assets/<file>?v=<content hash>`. The hosting CDN caches assets for a month whatever the app says, so a deploy
 * must change the URL, not the header. Hashed once per file per process; a missing file falls back to the bare path.
 */
export function assetUrl(file: string): string {
  const known = cache.get(file);
  if (known) return known;
  let url = `/assets/${file}`;
  try {
    const hash = createHash("sha256").update(readFileSync(join(findPublicDir(), file))).digest("hex").slice(0, HASH_CHARS);
    url = `${url}?v=${hash}`;
  } catch {
    // Missing file: serve the bare path; the request itself will 404 visibly.
  }
  cache.set(file, url);
  return url;
}
