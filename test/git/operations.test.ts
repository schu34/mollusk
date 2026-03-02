import fs from "fs/promises";
import path from "path";
import os from "os";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { simpleGit } from "simple-git";
import {
  buildCloneUrl,
  generateBranchName,
  cloneRepo,
  createBranch,
  commitAndPush,
} from "../../src/git/operations.js";

describe("buildCloneUrl", () => {
  test("returns correct URL format", () => {
    const url = buildCloneUrl("acme", "widgets", "tok_123");
    expect(url).toBe(
      "https://x-access-token:tok_123@github.com/acme/widgets.git",
    );
  });
});

describe("generateBranchName", () => {
  test("returns expected pattern", () => {
    const name = generateBranchName(42);
    expect(name).toMatch(/^mollusk\/issue-42-[0-9a-f]{6}$/);
  });

  test("generates unique names", () => {
    const a = generateBranchName(1);
    const b = generateBranchName(1);
    expect(a).not.toBe(b);
  });
});

describe("git operations (local bare repo)", () => {
  let tmpDir: string;
  let bareRepoPath: string;
  let workspacePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mollusk-git-test-"));
    bareRepoPath = path.join(tmpDir, "remote.git");
    workspacePath = path.join(tmpDir, "workspace");

    // Create a bare repo to act as "remote"
    await fs.mkdir(bareRepoPath);
    const bare = simpleGit(bareRepoPath);
    await bare.init(true);

    // Create an initial commit so the bare repo has a default branch
    const seedPath = path.join(tmpDir, "seed");
    await fs.mkdir(seedPath);
    const seed = simpleGit(seedPath);
    await seed.init();
    await seed.addConfig("user.email", "test@test.com");
    await seed.addConfig("user.name", "Test");
    await fs.writeFile(path.join(seedPath, "README.md"), "# init");
    await seed.add(".");
    await seed.commit("initial");
    await seed.addRemote("origin", bareRepoPath);
    await seed.push("origin", "main");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("cloneRepo clones into workspace", async () => {
    const git = await cloneRepo(bareRepoPath, workspacePath);
    const log = await git.log();
    expect(log.latest?.message).toBe("initial");
  });

  test("createBranch creates and checks out a new branch", async () => {
    const git = await cloneRepo(bareRepoPath, workspacePath);
    await createBranch(git, "mollusk/issue-99-abc123");
    const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    expect(branch).toBe("mollusk/issue-99-abc123");
  });

  test("commitAndPush stages, commits, and pushes", async () => {
    const git = await cloneRepo(bareRepoPath, workspacePath);
    await git.addConfig("user.email", "test@test.com");
    await git.addConfig("user.name", "Test");
    await createBranch(git, "mollusk/issue-1-def456");

    await fs.writeFile(path.join(workspacePath, "new-file.txt"), "hello");
    await commitAndPush(git, "add new file");

    // Verify the branch was pushed to the bare repo
    const bare = simpleGit(bareRepoPath);
    const branches = await bare.branch();
    expect(branches.all).toContain("mollusk/issue-1-def456");
  });
});
