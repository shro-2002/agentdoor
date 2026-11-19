/** Launcher failures carry a stable code and the HTTP status a route should answer with. */
export class LauncherError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "LauncherError";
  }
}

export const HTTP_BAD_REQUEST = 400;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_UNPROCESSABLE = 422;
export const HTTP_TOO_MANY = 429;
export const HTTP_UNAVAILABLE = 503;

export const validationFailed = (message: string): LauncherError =>
  new LauncherError("VALIDATION_FAILED", message, HTTP_BAD_REQUEST);
