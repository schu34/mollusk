import fs from "fs/promises";
import path from "path";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/config.js", () => {
  let tmpDir: string;
  return {
    getConfig: () => ({
      botUsername: "mollusk-bot",
      redisUrl: "redis://localhost:6379",
      workspaceBaseDir: tmpDir,
    }),
    _setTmpDir: (dir: string) => {
      tmpDir = dir;
    },
  };
});

const { createWorkspace, cleanupWorkspace } = await import(
  "../../src/git/workspace.js"
);
const { _setTmpDir } = (await import("../../src/config.js")) as any;

describe("workspace", () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = await fs.mkdtemp(
      path.join((await import("os")).default.tmpdir(), "mollusk-test-"),
    );
    _setTmpDir(testBaseDir);
  });

  afterEach(async () => {
    await fs.rm(testBaseDir, { recursive: true, force: true });
  });

  test("createWorkspace creates a directory that exists on disk", async () => {
    const workspace = await createWorkspace("myorg", "myrepo", 42);
    const stat = await fs.stat(workspace);
    expect(stat.isDirectory()).toBe(true);
    await cleanupWorkspace(workspace);
  });

  test("directory name includes owner, repo, and issue number", async () => {
    const workspace = await createWorkspace("acme", "widgets", 7);
    const dirName = path.basename(workspace);
    expect(dirName).toContain("acme");
    expect(dirName).toContain("widgets");
    expect(dirName).toContain("7");
    expect(dirName).toMatch(/^mollusk-acme-widgets-7-[0-9a-f]+$/);
    await cleanupWorkspace(workspace);
  });

  test("cleanupWorkspace removes the directory", async () => {
    const workspace = await createWorkspace("org", "repo", 1);
    await cleanupWorkspace(workspace);
    await expect(fs.stat(workspace)).rejects.toThrow();
  });
});
