import type { ConnectionOptions } from "bullmq";
import { getConfig } from "../config.js";

export function getConnectionOptions(): ConnectionOptions {
  const url = new URL(getConfig().redisUrl);
  return {
    host: url.hostname || "localhost",
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}
