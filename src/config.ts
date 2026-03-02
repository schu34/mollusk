import os from "os";

export interface Config {
  botUsername: string;
  redisUrl: string;
  workspaceBaseDir: string;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const botUsername = process.env.BOT_USERNAME;
  if (!botUsername) {
    throw new Error("BOT_USERNAME environment variable is required");
  }

  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const workspaceBaseDir = process.env.WORKSPACE_BASE_DIR || os.tmpdir();

  _config = { botUsername, redisUrl, workspaceBaseDir };
  return _config;
}
