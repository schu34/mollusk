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

export interface PRReviewContext {
  prTitle: string;
  prBody: string;
  diff: string;
  reviewComments: Array<{ author: string; body: string; path: string; line?: number }>;
}

const MAX_DIFF_LENGTH = 50_000;

export async function fetchPRReviewContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRReviewContext> {
  const { data: pr } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    { owner, repo, pull_number: prNumber },
  );

  const { data: files } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
    { owner, repo, pull_number: prNumber },
  );

  let diff = files
    .map((f) => `--- ${f.filename}\n${f.patch ?? ""}`)
    .join("\n\n");

  if (diff.length > MAX_DIFF_LENGTH) {
    diff = diff.slice(0, MAX_DIFF_LENGTH) + "\n\n_(diff truncated)_";
  }

  const { data: comments } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
    { owner, repo, pull_number: prNumber },
  );

  const reviewComments = comments.map((c) => ({
    author: c.user?.login ?? "unknown",
    body: c.body ?? "",
    path: c.path,
    line: c.line ?? undefined,
  }));

  return {
    prTitle: pr.title,
    prBody: pr.body ?? "",
    diff,
    reviewComments,
  };
}

export function buildPRReviewPrompt(
  reviewContext: PRReviewContext,
  userPrompt: string,
): string {
  let prompt = `You are working on a pull request. Address the review feedback.

## PR: ${reviewContext.prTitle}
${reviewContext.prBody}

## Current Diff
\`\`\`diff
${reviewContext.diff}
\`\`\`
`;

  if (reviewContext.reviewComments.length > 0) {
    prompt += "\n## Review Comments\n";
    for (const comment of reviewContext.reviewComments) {
      const location = comment.line ? `${comment.path}:${comment.line}` : comment.path;
      prompt += `**${comment.author}** on \`${location}\`:\n${comment.body}\n\n`;
    }
  }

  prompt += `## Task
${userPrompt}

Address the review feedback. Do not ask questions — just make your best judgment and write the code.`;

  return prompt;
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
