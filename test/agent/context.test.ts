import { describe, test, expect, vi } from "vitest";
import { fetchIssueContext, buildAgentPrompt } from "../../src/agent/context.js";

function createMockOctokit(issueData: any, commentsData: any[]) {
  return {
    request: vi.fn().mockImplementation((route: string) => {
      if (route.startsWith("GET /repos/{owner}/{repo}/issues/{issue_number}/comments")) {
        return Promise.resolve({ data: commentsData });
      }
      if (route.startsWith("GET /repos/{owner}/{repo}/issues/{issue_number}")) {
        return Promise.resolve({ data: issueData });
      }
      throw new Error(`Unexpected route: ${route}`);
    }),
  } as any;
}

describe("fetchIssueContext", () => {
  test("returns correct title, body, and comments from API", async () => {
    const octokit = createMockOctokit(
      { title: "Add README", body: "We need a README file" },
      [
        { user: { login: "alice" }, body: "I agree" },
        { user: { login: "bob" }, body: "Me too" },
      ],
    );

    const result = await fetchIssueContext(octokit, "owner", "repo", 1);

    expect(result.title).toBe("Add README");
    expect(result.body).toBe("We need a README file");
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toEqual({ author: "alice", body: "I agree" });
    expect(result.comments[1]).toEqual({ author: "bob", body: "Me too" });
  });

  test("handles issue with no comments", async () => {
    const octokit = createMockOctokit(
      { title: "Bug fix", body: "Fix the thing" },
      [],
    );

    const result = await fetchIssueContext(octokit, "owner", "repo", 2);

    expect(result.comments).toHaveLength(0);
  });

  test("handles null issue body", async () => {
    const octokit = createMockOctokit(
      { title: "Empty issue", body: null },
      [],
    );

    const result = await fetchIssueContext(octokit, "owner", "repo", 3);

    expect(result.body).toBe("");
  });
});

describe("buildAgentPrompt", () => {
  test("output contains all sections", () => {
    const context = {
      title: "Add feature",
      body: "Please add a new feature",
      comments: [
        { author: "alice", body: "Looks good" },
      ],
    };

    const prompt = buildAgentPrompt(context, "implement the feature");

    expect(prompt).toContain("## Issue: Add feature");
    expect(prompt).toContain("Please add a new feature");
    expect(prompt).toContain("## Conversation");
    expect(prompt).toContain("**alice**: Looks good");
    expect(prompt).toContain("## Task");
    expect(prompt).toContain("implement the feature");
    expect(prompt).toContain("Do not ask questions");
  });

  test("omits conversation section when no comments", () => {
    const context = {
      title: "Simple issue",
      body: "Do the thing",
      comments: [],
    };

    const prompt = buildAgentPrompt(context, "do it");

    expect(prompt).not.toContain("## Conversation");
    expect(prompt).toContain("## Issue: Simple issue");
    expect(prompt).toContain("## Task");
  });
});
