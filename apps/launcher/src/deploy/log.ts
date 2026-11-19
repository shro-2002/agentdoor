/** Names-only structured log: callers pass step/label names and counts, never argv or values. */
export type DeployLog = (event: Record<string, string | number | boolean>) => void;

export const stdoutLog: DeployLog = (event) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};
