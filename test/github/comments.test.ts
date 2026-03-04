import { describe, test, expect, vi } from "vitest";
import {
  postComment,
  postCompletionComment,
  postErrorComment,
} from "../../src/github/comments.js";

function createMockOctokit() {
  return { request: vi.fn().mockResolvedValue({}) } as any;
}

describe("postComment", () => {
  test("calls correct endpoint with body", async () => {
    const octokit = createMockOctokit();

    await postComment(octokit, "owner", "repo", 42, "Hello");

    expect(octokit.request).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      { owner: "owner", repo: "repo", issue_number: 42, body: "Hello" },
    );
  });
});

describe("postCompletionComment", () => {
  test("mentions sender and includes PR URL", async () => {
    const octokit = createMockOctokit();

    await postCompletionComment(
      octokit, "owner", "repo", 1, "alice", "https://github.com/owner/repo/pull/10",
    );

    const body = octokit.request.mock.calls[0][1].body as string;
    expect(body).toContain("@alice");
    expect(body).toContain("https://github.com/owner/repo/pull/10");
  });
});

describe("postErrorComment", () => {
  test("truncates long error messages to 500 chars", async () => {
    const octokit = createMockOctokit();
    const longError = "x".repeat(600);

    await postErrorComment(octokit, "owner", "repo", 1, "alice", longError);

    const body = octokit.request.mock.calls[0][1].body as string;
    expect(body).toContain("@alice");
    expect(body).toContain("...");
    // 500 chars of error + "..." should be present but not the full 600
    expect(body).not.toContain("x".repeat(600));
  });

  test("does not truncate short error messages", async () => {
    const octokit = createMockOctokit();

    await postErrorComment(octokit, "owner", "repo", 1, "bob", "Something broke");

    const body = octokit.request.mock.calls[0][1].body as string;
    expect(body).toContain("Something broke");
    expect(body).not.toContain("...");
  });
});
