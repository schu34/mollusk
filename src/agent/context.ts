import type { Octokit } from "@octokit/core";

export interface IssueContext {
  title: string;
  body: string;
  comments: Array<{ author: string; body: string }>;
}

export async function fetchIssueContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueContext> {
  const { data: issue } = await octokit.request(
    "GET /repos/{owner}/{repo}/issues/{issue_number}",
    { owner, repo, issue_number: issueNumber },
  );

  const { data: rawComments } = await octokit.request(
    "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
    { owner, repo, issue_number: issueNumber },
  );

  const comments = rawComments.map((c) => ({
    author: c.user?.login ?? "unknown",
    body: c.body ?? "",
  }));

  return {
    title: issue.title,
    body: issue.body ?? "",
    comments,
  };
}

export function buildAgentPrompt(
  issueContext: IssueContext,
  userPrompt: string,
): string {
  let prompt = `You are working on a GitHub issue. Make the requested changes to the codebase.

## Issue: ${issueContext.title}
${issueContext.body}
`;

  if (issueContext.comments.length > 0) {
    prompt += "\n## Conversation\n";
    for (const comment of issueContext.comments) {
      prompt += `**${comment.author}**: ${comment.body}\n\n`;
    }
  }

  prompt += `## Task
${userPrompt}

Implement the changes. Do not ask questions — just make your best judgment and write the code.`;

  return prompt;
}
