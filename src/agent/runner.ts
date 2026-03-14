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

const ALLOWED_BASH_COMMANDS = new Set([
  // Build / runtime
  "npm", "npx", "node", "tsc", "prettier", "eslint",
  // File operations
  "ls", "cat", "mkdir", "cp", "mv", "rm", "touch", "chmod",
  "head", "tail", "wc", "sort", "uniq", "diff", "tee",
  // Search / text processing
  "grep", "find", "sed", "awk", "xargs", "tr", "cut",
  // Shell basics
  "echo", "printf", "env", "pwd", "which", "test", "true", "false",
  "cd", "export", "set",
]);

export function extractBaseCommand(command: string): string {
  // Strip leading env vars (FOO=bar cmd), subshell parens, semicolons
  const stripped = command.trimStart().replace(/^(\w+=\S*\s+)*/, "");
  // Get the first token
  const match = stripped.match(/^[("']*([a-zA-Z0-9_./-]+)/);
  return match ? path.basename(match[1]) : "";
}

export function isCommandAllowed(command: string): boolean {
  // Split on pipes, &&, ||, ; to check each sub-command
  const subCommands = command.split(/\s*(?:\|+|&&|\|\||;)\s*/);
  return subCommands.every((sub) => {
    const base = extractBaseCommand(sub.trim());
    if (!base) return true; // empty segment (trailing pipe, etc.)
    return ALLOWED_BASH_COMMANDS.has(base);
  });
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
        canUseTool: async (toolName, input) => {
          if (toolName !== "Bash") {
            return { behavior: "allow" as const };
          }

          const command = (input as { command?: string }).command ?? "";
          if (isCommandAllowed(command)) {
            return { behavior: "allow" as const };
          }

          const base = extractBaseCommand(command);
          app.log.error(
            { command, blockedCommand: base },
            "Agent Bash command blocked by allowlist: %s",
            base,
          );

          return {
            behavior: "deny" as const,
            message: `Command "${base}" is not in the allowed commands list. Allowed: ${[...ALLOWED_BASH_COMMANDS].join(", ")}`,
          };
        },
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
