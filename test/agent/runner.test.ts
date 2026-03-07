import { describe, test, expect, vi, beforeEach } from "vitest";
import { Writable } from "node:stream";

vi.mock("../../src/config.js", () => ({
  getConfig: vi.fn(() => ({ agentTimeout: 900_000 })),
}));

vi.mock("../../src/app.js", () => ({
  getApp: vi.fn(() => ({
    log: {
      info: vi.fn(),
      error: vi.fn(),
    },
  })),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdtempSync: vi.fn((prefix: string) => prefix + "XXXXXX"),
    createWriteStream: vi.fn(() =>
      new Writable({ write(_chunk, _enc, cb) { cb(); } }),
    ),
  };
});

const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return { mockQuery };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
}));

import { runAgent } from "../../src/agent/runner.js";

async function* makeMessages(messages: unknown[]) {
  for (const msg of messages) {
    yield msg;
  }
}

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns success when agent produces a result", async () => {
    mockQuery.mockReturnValue(
      makeMessages([
        { type: "system", subtype: "init", session_id: "test-session" },
        { type: "assistant", content: "Working on it..." },
        { result: "Changes applied" },
      ]),
    );

    const result = await runAgent("do something", "/tmp/workspace");

    expect(result.success).toBe(true);
    expect(result.output).toBe("Changes applied");
    expect(result.logFile).toContain("agent.log");
    expect(result.logFile).not.toContain("/tmp/workspace");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "do something",
        options: expect.objectContaining({
          cwd: "/tmp/workspace",
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          maxTurns: 200,
        }),
      }),
    );
  });

  test("returns failure when agent throws an error", async () => {
    async function* failing() {
      yield { type: "system", subtype: "init", session_id: "s" };
      throw new Error("something went wrong");
    }
    mockQuery.mockReturnValue(failing());

    const result = await runAgent("do something", "/tmp/workspace");

    expect(result.success).toBe(false);
    expect(result.error).toBe("something went wrong");
  });

  test("returns timeout error when aborted", async () => {
    const { getConfig } = await import("../../src/config.js");
    vi.mocked(getConfig).mockReturnValue({ agentTimeout: 50 } as any);

    // Capture the abortController passed to query() and simulate
    // the real SDK behavior: throw when aborted
    mockQuery.mockImplementation(({ options }: any) => {
      const ac: AbortController = options.abortController;
      return (async function* () {
        yield { type: "system", subtype: "init", session_id: "s" };
        await new Promise<void>((_resolve, reject) => {
          if (ac.signal.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          ac.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      })();
    });

    const result = await runAgent("do something", "/tmp/workspace");

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");

    vi.mocked(getConfig).mockReturnValue({ agentTimeout: 900_000 } as any);
  });
});
