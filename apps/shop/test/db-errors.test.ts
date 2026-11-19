import { describe, expect, it } from "vitest";
import { isTransientDbError } from "../src/db/errors.js";

const withCode = (code: string) => Object.assign(new Error("db said no"), { code });

describe("isTransientDbError", () => {
  it.each([
    "ECONNREFUSED",
    "PROTOCOL_CONNECTION_LOST",
    "ER_CON_COUNT_ERROR",
    "ER_TOO_MANY_USER_CONNECTIONS",
    "ER_USER_LIMIT_REACHED",
  ])("%s is transient (RETRY_LATER, not 500)", (code) => {
    expect(isTransientDbError(withCode(code))).toBe(true);
  });

  it("a plain bug or a SQL error is not transient", () => {
    expect(isTransientDbError(new Error("boom"))).toBe(false);
    expect(isTransientDbError(withCode("ER_PARSE_ERROR"))).toBe(false);
    expect(isTransientDbError("ECONNREFUSED")).toBe(false);
  });
});
