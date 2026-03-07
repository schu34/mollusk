import type { Context } from "probot";
import type { Octokit } from "@octokit/core";

export async function postAcknowledgment(
  context: Context<"issue_comment.created">,
  sender: string,
  prompt: string,
): Promise<void> {
  const truncatedPrompt =
    prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt;

  await context.octokit.issues.createComment(
    context.issue({
      body: `👋 @${sender} I'm on it! Working on:\n> ${truncatedPrompt}`,
    }),
  );
}

export async function postComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    { owner, repo, issue_number: issueNumber, body },
  );
}

export async function postCompletionComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  sender: string,
  prUrl: string,
): Promise<void> {
  await postComment(
    octokit,
    owner,
    repo,
    issueNumber,
    `@${sender} Done! I've opened a PR: ${prUrl}`,
  );
}

export async function postErrorComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  sender: string,
  errorMessage: string,
): Promise<void> {
  const truncated =
    errorMessage.length > 500 ? errorMessage.slice(0, 500) + "..." : errorMessage;

  await postComment(
    octokit,
    owner,
    repo,
    issueNumber,
    `@${sender} Sorry, I ran into an error:\n\`\`\`\n${truncated}\n\`\`\``,
  );
}
