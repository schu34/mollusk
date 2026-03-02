import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getConfig } from "../config.js";

export async function createWorkspace(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<string> {
  const baseDir = getConfig().workspaceBaseDir;
  const random = crypto.randomBytes(4).toString("hex");
  const dirName = `mollusk-${owner}-${repo}-${issueNumber}-${random}`;
  const workspacePath = path.join(baseDir, dirName);
  await fs.mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  await fs.rm(workspacePath, { recursive: true, force: true });
}
