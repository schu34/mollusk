import { describe, test, expect, vi } from "vitest";
import {
  createPullRequest,
  buildPRTitle,
  buildPRBody,
} from "../../src/github/pulls.js";

function createMockOctokit(prData = { number: 10, html_url: "https://github.com/o/r/pull/10" }) {
  return {
    request: vi.fn().mockImplementation((route: string) => {
      if (route.startsWith("POST /repos/{owner}/{repo}/pulls/{pull_number}")) {
        return Promise.resolve({});
      }
      if (route.startsWith("POST /repos/{owner}/{repo}/pulls")) {
        return Promise.resolve({ data: prData });
      }
      throw new Error(`Unexpected route: ${route}`);
    }),
  } as any;
}

describe("createPullRequest", () => {
  test("calls correct endpoints and returns prNumber/prUrl", async () => {
    const octokit = createMockOctokit();

    const result = await createPullRequest({
      octokit,
      owner: "owner",
      repo: "repo",
      head: "mollusk/issue-1-abc",
      base: "main",
      title: "Fix bug (#1)",
      body: "Closes #1",
      reviewer: "alice",
    });

    expect(result).toEqual({
      prNumber: 10,
      prUrl: "https://github.com/o/r/pull/10",
    });

    expect(octokit.request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/pulls",
      expect.objectContaining({
        owner: "owner",
        repo: "repo",
        head: "mollusk/issue-1-abc",
        base: "main",
      }),
    );

    expect(octokit.request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers",
      expect.objectContaining({
        pull_number: 10,
        reviewers: ["alice"],
      }),
    );
  });

  test("does not throw when review request fails", async () => {
    const octokit = {
      request: vi.fn().mockImplementation((route: string) => {
        if (route.startsWith("POST /repos/{owner}/{repo}/pulls/{pull_number}")) {
          return Promise.reject(new Error("Cannot request review"));
        }
        if (route.startsWith("POST /repos/{owner}/{repo}/pulls")) {
          return Promise.resolve({ data: { number: 5, html_url: "https://github.com/o/r/pull/5" } });
        }
        throw new Error(`Unexpected route: ${route}`);
      }),
    } as any;

    const result = await createPullRequest({
      octokit,
      owner: "owner",
      repo: "repo",
      head: "branch",
      base: "main",
      title: "Title",
      body: "Body",
      reviewer: "owner",
    });

    expect(result.prNumber).toBe(5);
  });
});

describe("buildPRTitle", () => {
  test("appends issue number", () => {
    expect(buildPRTitle("Add README", 42)).toBe("Add README (#42)");
  });

  test("truncates long titles to stay under 70 chars", () => {
    const longTitle = "A".repeat(80);
    const result = buildPRTitle(longTitle, 1);
    expect(result.length).toBeLessThanOrEqual(70);
    expect(result).toContain("...");
    expect(result).toContain("(#1)");
  });
});

describe("buildPRBody", () => {
  test("contains Closes reference", () => {
    const body = buildPRBody(42, "Made some changes");
    expect(body).toContain("Closes #42");
  });

  test("truncates long agent output", () => {
    const longOutput = "x".repeat(6000);
    const body = buildPRBody(1, longOutput);
    expect(body).toContain("_(output truncated)_");
    expect(body).not.toContain("x".repeat(6000));
  });

  test("contains attribution footer", () => {
    const body = buildPRBody(1, "changes");
    expect(body).toContain("mollusk");
  });
});
