export interface Config {
  botUsername: string;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const botUsername = process.env.BOT_USERNAME;
  if (!botUsername) {
    throw new Error("BOT_USERNAME environment variable is required");
  }

  _config = { botUsername };
  return _config;
}
