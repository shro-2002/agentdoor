import { describe, expect, it } from "vitest";
import { MIGRATION_STATEMENTS } from "../src/db/migrations.js";

describe("migrations (04 section 6)", () => {
  it("every CREATE TABLE sets DEFAULT CHARSET=utf8mb4", () => {
    expect(MIGRATION_STATEMENTS).toHaveLength(10);
    for (const sql of MIGRATION_STATEMENTS) expect(sql).toMatch(/DEFAULT CHARSET=utf8mb4\s*$/);
  });

  it("is additive only: every statement is CREATE TABLE IF NOT EXISTS", () => {
    for (const sql of MIGRATION_STATEMENTS) expect(sql).toMatch(/^CREATE TABLE IF NOT EXISTS /);
  });
});
