import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  getConfig: vi.fn(() => ({ agentTimeout: 900_000 })),
}));

import { execFile } from "node:child_process";
import { runAgent } from "../../src/agent/runner.js";

const mockExecFile = vi.mocked(execFile);

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns success when agent exits cleanly", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      callback(null, "Changes applied successfully", "");
      return undefined as any;
    });

    const result = await runAgent("do something", "/tmp/workspace");

    expect(result).toEqual({
      success: true,
      output: "Changes applied successfully",
    });
    expect(mockExecFile).toHaveBeenCalledWith(
      "claude",
      ["-p", "do something"],
      expect.objectContaining({ cwd: "/tmp/workspace" }),
      expect.any(Function),
    );
  });

  test("returns failure with stderr on non-zero exit", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      const error = new Error("Command failed") as any;
      error.killed = false;
      callback(error, "partial output", "something went wrong");
      return undefined as any;
    });

    const result = await runAgent("do something", "/tmp/workspace");

    expect(result).toEqual({
      success: false,
      output: "partial output",
      error: "something went wrong",
    });
  });

  test("returns timeout error when process is killed", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      const error = new Error("Process timed out") as any;
      error.killed = true;
      callback(error, "", "");
      return undefined as any;
    });

    const result = await runAgent("do something", "/tmp/workspace");

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  test("uses error.message when stderr is empty", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
      const error = new Error("ENOENT") as any;
      error.killed = false;
      callback(error, "", "");
      return undefined as any;
    });

    const result = await runAgent("do something", "/tmp/workspace");

    expect(result).toEqual({
      success: false,
      output: undefined,
      error: "ENOENT",
    });
  });
});
