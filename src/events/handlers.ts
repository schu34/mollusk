import type { Probot } from "probot";
import { getConfig } from "../config.js";
import { parseMention } from "./parse.js";
import { postAcknowledgment } from "../github/comments.js";
import { getAgentQueue } from "../queue/queues.js";
import type { AgentJobData } from "../queue/jobs.js";

export function registerHandlers(app: Probot): void {
  app.on("issues.opened", async (context) => {
    context.log.info(
      { issue: context.payload.issue.number, repository: context.payload.repository.full_name },
      "New issue opened #%d in %s",
      context.payload.issue.number,
      context.payload.repository.full_name,
    );
    const issueComment = context.issue({
      body: "Thanks for opening this issue!",
    });
    await context.octokit.issues.createComment(issueComment);
  });

  app.on("issue_comment.created", async (context) => {
    const { comment, issue, repository, sender } = context.payload;

    context.log.info(
      { sender: sender.login, comment: comment.body },
      "Received new comment on issue #%d in %s/%s",
      issue.number,
      repository.owner.login,
      repository.name,
    )

    // Ignore comments from bots to avoid loops
    if (sender.type === "Bot") return;

    const config = getConfig();
    const mention = parseMention(
      comment.body ?? "",
      config.botUsername,
      sender.login,
      repository.owner.login,
      repository.name,
      issue.number,
    );

    if (!mention) {
      context.log.info(
        { sender: sender.login, comment: comment.body },
        "No mention detected, ignoring comment",
      );
      return
    };

    context.log.info(
      { sender: mention.sender, prompt: mention.prompt },
      "Mention detected, posting acknowledgment",
    );

    await postAcknowledgment(context, mention.sender, mention.prompt);

    const jobData: AgentJobData = {
      owner: mention.owner,
      repo: mention.repo,
      issueNumber: mention.issueNumber,
      sender: mention.sender,
      prompt: mention.prompt,
      installationId: context.payload.installation?.id ?? 0,
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
  });
}
