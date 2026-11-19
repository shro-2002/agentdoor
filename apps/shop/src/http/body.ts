import express from "express";

/** 03 §7.4: bodies are capped at 16 KB; anything bigger is answered 413 by the error handler. */
export const BODY_LIMIT = "16kb";

export const jsonBody = express.json({ limit: BODY_LIMIT });
export const formBody = express.urlencoded({ extended: false, limit: BODY_LIMIT });
