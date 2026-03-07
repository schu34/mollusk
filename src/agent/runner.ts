import { query } from "@anthropic-ai/claude-agent-sdk";
import { createWriteStream, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfig } from "../config.js";
import { getApp } from "../app.js";

export interface AgentResult {
  success: boolean;
  output?: string;
  error?: string;
  logFile?: string;
}

export async function runAgent(
  prompt: string,
  workspacePath: string
): Promise<AgentResult> {
  const { agentTimeout } = getConfig();

  const app = getApp();
  app.log.info("Running agent with prompt: " + prompt);

  const logDir = mkdtempSync(path.join(os.tmpdir(), "mollusk-agent-log-"));
  const logFile = path.join(logDir, "agent.log");
  const logStream = createWriteStream(logFile);

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), agentTimeout);

  try {
    let resultText = "";

    for await (const message of query({
      prompt,
      options: {
        cwd: workspacePath,
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 200,
        abortController,
      },
    })) {
      logStream.write(JSON.stringify(message) + "\n");

      if ("result" in message) {
        resultText = message.result;
      }
    }

    clearTimeout(timer);
    logStream.end();

    app.log.info("Agent output:\n" + resultText);

    return { success: true, output: resultText, logFile };
  } catch (err: unknown) {
    clearTimeout(timer);
    logStream.end();

    if (abortController.signal.aborted) {
      return {
        success: false,
        error: `Agent timed out after ${agentTimeout / 1000}s`,
        logFile,
      };
    }

    const errorMessage =
      err instanceof Error ? err.message : String(err);
    app.log.error("Agent error: " + errorMessage);

    return {
      success: false,
      error: errorMessage,
      logFile,
    };
  }
}
