import { getConfig } from "../config.js";
import { getApp } from "../app.js";
import { parseMention } from "./parse.js";
import { postAcknowledgment } from "../github/comments.js";
import { getAgentQueue } from "../queue/queues.js";
import type { IssueJobData, PRReviewJobData } from "../queue/jobs.js";

async function handleIssueMention(
  context: { log: { info: Function; error: Function }; payload: { installation?: { id: number } } },
  body: string,
  senderLogin: string,
  owner: string,
  repo: string,
  issueNumber: number,
  installationId: number,
): Promise<void> {
  const config = getConfig();
  const mention = parseMention(body, config.botUsername, senderLogin, owner, repo, issueNumber);

  if (!mention) {
    context.log.info("No mention detected, ignoring");
    return;
  }

  context.log.info(
    { sender: mention.sender, prompt: mention.prompt },
    "Mention detected, posting acknowledgment",
  );

  await postAcknowledgment(context as any, mention.sender, mention.prompt);

  const jobData: IssueJobData = {
    type: "issue",
    owner: mention.owner,
    repo: mention.repo,
    issueNumber: mention.issueNumber,
    sender: mention.sender,
    prompt: mention.prompt,
    installationId,
  };

  try {
    await getAgentQueue().add(
      `${jobData.owner}/${jobData.repo}#${jobData.issueNumber}`,
      jobData,
    );
    context.log.info({ jobData }, "Enqueued agent job");
  } catch (err) {
    context.log.error({ err }, "Failed to enqueue agent job");
  }
}

async function handlePRMention(
  context: { log: { info: Function; error: Function }; octokit: { issues: { createComment: Function }; request: Function } },
  body: string,
  senderLogin: string,
  owner: string,
  repo: string,
  prNumber: number,
  prBranch: string,
  installationId: number,
  replyToCommentId?: number,
): Promise<void> {
  const config = getConfig();
  const mention = parseMention(body, config.botUsername, senderLogin, owner, repo, prNumber);

  if (!mention) {
    context.log.info("No mention detected, ignoring");
    return;
  }

  context.log.info(
    { sender: mention.sender, prompt: mention.prompt },
    "Mention detected in PR review, posting acknowledgment",
  );

  const truncatedPrompt =
    mention.prompt.length > 100 ? mention.prompt.slice(0, 100) + "..." : mention.prompt;
  const ackBody = `👋 @${mention.sender} I'm on it! Working on:\n> ${truncatedPrompt}`;

  if (replyToCommentId) {
    // Reply in the review comment thread
    await context.octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
      { owner, repo, pull_number: prNumber, comment_id: replyToCommentId, body: ackBody },
    );
  } else {
    // Top-level PR comment (e.g. from a review submission)
    await context.octokit.issues.createComment({
      owner, repo, issue_number: prNumber, body: ackBody,
    });
  }

  const jobData: PRReviewJobData = {
    type: "pr_review",
    owner: mention.owner,
    repo: mention.repo,
    prNumber,
    prBranch,
    sender: mention.sender,
    prompt: mention.prompt,
    installationId,
  };

  try {
    await getAgentQueue().add(
      `${jobData.owner}/${jobData.repo}#${jobData.prNumber}`,
      jobData,
    );
    context.log.info({ jobData }, "Enqueued PR review job");
  } catch (err) {
    context.log.error({ err }, "Failed to enqueue PR review job");
  }
}

export function registerHandlers(): void {
  const app = getApp();

  app.on("issues.opened", async (context) => {
    const { issue, repository, sender } = context.payload;

    context.log.info(
      { issue: issue.number, repository: repository.full_name },
      "New issue opened #%d in %s",
      issue.number,
      repository.full_name,
    );

    if (sender.type === "Bot") return;

    await handleIssueMention(
      context, issue.body ?? "", sender.login,
      repository.owner.login, repository.name, issue.number,
      context.payload.installation?.id ?? 0,
    );
  });

  app.on("issue_comment.created", async (context) => {
    const { comment, issue, repository, sender } = context.payload;

    context.log.info(
      { sender: sender.login, comment: comment.body },
      "Received new comment on issue #%d in %s/%s",
      issue.number,
      repository.owner.login,
      repository.name,
    );

    if (sender.type === "Bot") return;

    await handleIssueMention(
      context, comment.body ?? "", sender.login,
      repository.owner.login, repository.name, issue.number,
      context.payload.installation?.id ?? 0,
    );
  });

  app.on("pull_request_review_comment.created", async (context) => {
    const { comment, pull_request, repository, sender } = context.payload;

    context.log.info(
      { sender: sender.login, pr: pull_request.number },
      "Received review comment on PR #%d in %s/%s",
      pull_request.number,
      repository.owner.login,
      repository.name,
    );

    if (sender.type === "Bot") return;

    await handlePRMention(
      context, comment.body ?? "", sender.login,
      repository.owner.login, repository.name,
      pull_request.number, pull_request.head.ref,
      context.payload.installation?.id ?? 0,
      comment.id,
    );
  });

  app.on("pull_request_review.submitted", async (context) => {
    const { review, pull_request, repository, sender } = context.payload;

    context.log.info(
      { sender: sender.login, pr: pull_request.number },
      "Received review on PR #%d in %s/%s",
      pull_request.number,
      repository.owner.login,
      repository.name,
    );

    if (sender.type === "Bot") return;
    if (!review.body) return;

    await handlePRMention(
      context, review.body, sender.login,
      repository.owner.login, repository.name,
      pull_request.number, pull_request.head.ref,
      context.payload.installation?.id ?? 0,
    );
  });
}
