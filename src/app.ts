import type { Probot } from "probot";

let _app: Probot | null = null;

export function initApp(app: Probot): void {
  _app = app;
}

export function getApp(): Probot {
  if (!_app) {
    throw new Error("App not initialized — call initApp(app) first");
  }
  return _app;
}
