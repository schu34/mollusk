import { execFile } from "node:child_process";
import { getConfig } from "../config.js";

export interface AgentResult {
  success: boolean;
  output?: string;
  error?: string;
}

export function runAgent(
  prompt: string,
  workspacePath: string,
): Promise<AgentResult> {
  const { agentTimeout } = getConfig();

  return new Promise((resolve) => {
    execFile(
      "claude",
      ["-p", prompt],
      {
        cwd: workspacePath,
        timeout: agentTimeout,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ success: true, output: stdout });
          return;
        }

        if (error.killed) {
          resolve({
            success: false,
            error: `Agent timed out after ${agentTimeout / 1000}s`,
          });
          return;
        }

        resolve({
          success: false,
          output: stdout || undefined,
          error: stderr || error.message,
        });
      },
    );
  });
}
