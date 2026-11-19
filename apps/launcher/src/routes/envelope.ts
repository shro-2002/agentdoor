import type { Response } from "express";

/** `{data, error, meta:{requestId}}` for every launcher response (CLAUDE.md). */
const meta = (res: Response) => ({ requestId: String(res.locals.requestId ?? "") });

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data, error: null, meta: meta(res) });
}

export function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ data: null, error: { code, message }, meta: meta(res) });
}
