/**
 * Every gddy invocation the deploy makes, in one place. Labels are what gets logged (never argv).
 * VERIFIED in the T01 spike: app list/create, operation get, source upload, app get, subscription get,
 * log list, app restart. NOT YET VERIFIED live (confirm with `gddy hosting --help` before the live run):
 * source import list, secret list, deployment publish, operation polling flag names, domain list.
 */
export interface Cmd {
  label: string;
  argv: string[];
}

export const APP_NAME = "agentdoor-shop";
const NODEJS = ["--app-type", "NODEJS"];

export const cmd = {
  listApps: (): Cmd => ({ label: "hosting app list", argv: ["hosting", "app", "list", ...NODEJS] }),
  createApp: (): Cmd => ({ label: "hosting app create", argv: ["hosting", "app", "create", ...NODEJS, "--name", APP_NAME] }),
  getApp: (appId: string): Cmd => ({ label: "hosting app get", argv: ["hosting", "app", "get", "--app-id", appId] }),
  getOperation: (opId: string): Cmd => ({ label: "operation get", argv: ["operation", "get", opId] }),
  getSubscription: (appId: string): Cmd => ({
    label: "hosting subscription get",
    argv: ["hosting", "subscription", "get", "--app-id", appId],
  }),
  upload: (appId: string, file: string): Cmd => ({
    label: "hosting source upload",
    argv: ["hosting", "source", "upload", "--app-id", appId, "--file", file],
  }),
  listImports: (appId: string): Cmd => ({
    label: "hosting source import list",
    argv: ["hosting", "source", "import", "list", "--app-id", appId],
  }),
  getImport: (appId: string, importId: string): Cmd => ({
    label: "hosting source import get",
    argv: ["hosting", "source", "import", "get", "--app-id", appId, "--import-id", importId],
  }),
  listSecrets: (appId: string, variant: string): Cmd => ({
    label: "hosting secret list",
    argv: ["hosting", "secret", "list", "--app-id", appId, "--variant", variant],
  }),
  restart: (appId: string, variant: string): Cmd => ({
    label: "hosting app restart",
    argv: ["hosting", "app", "restart", "--app-id", appId, "--variant", variant],
  }),
  logs: (appId: string, variant: string): Cmd => ({
    label: "hosting log list",
    argv: ["hosting", "log", "list", "--app-id", appId, "--variant", variant],
  }),
  publish: (appId: string): Cmd => ({
    label: "hosting deployment publish",
    argv: ["hosting", "deployment", "publish", "--app-id", appId],
  }),
  listDomains: (appId: string): Cmd => ({
    label: "hosting domain list",
    argv: ["hosting", "domain", "list", "--app-id", appId],
  }),
};
