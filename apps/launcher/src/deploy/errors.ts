/** Deploy failures carry a stable code and the HTTP status a launcher route should map them to. */
export class DeployError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "DeployError";
  }
}

export const gateBlocked = (reason: string): DeployError =>
  new DeployError("GATE_BLOCKED", `launch gate blocked: ${reason}`, 409);
