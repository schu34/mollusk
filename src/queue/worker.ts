import { Worker } from "bullmq";
import type { Probot } from "probot";
import { getConnectionOptions } from "./connection.js";
import type { AgentJobData, AgentJobResult } from "./jobs.js";
import { getInstallationToken } from "../github/auth.js";
import { createWorkspace, cleanupWorkspace } from "../git/workspace.js";
import {
  cloneRepo,
  createBranch,
  buildCloneUrl,
  generateBranchName,
  commitAndPush,
} from "../git/operations.js";
import { getConfig } from "../config.js";
import { fetchIssueContext, buildAgentPrompt } from "../agent/context.js";
import { runAgent } from "../agent/runner.js";
import {
  postCompletionComment,
  postErrorComment,
} from "../github/comments.js";
import { createPullRequest, buildPRTitle, buildPRBody } from "../github/pulls.js";

export function startWorker(app: Probot): Worker<AgentJobData, AgentJobResult> {
  const worker = new Worker<AgentJobData, AgentJobResult>(
    "agent-jobs",
    async (job) => {
      const { owner, repo, issueNumber, installationId, sender, prompt } = job.data;

      app.log.info(
        { jobId: job.id, data: job.data },
        "Processing agent job %s/%s#%d",
        owner,
        repo,
        issueNumber,
      );

      let workspace: string | undefined;
      try {
        const token = await getInstallationToken(app, installationId);
        workspace = await createWorkspace(owner, repo, issueNumber);
        const cloneUrl = buildCloneUrl(owner, repo, token);
        const git = await cloneRepo(cloneUrl, workspace);
        const branchName = generateBranchName(issueNumber);
        await createBranch(git, branchName);

        app.log.info(
          { jobId: job.id, branch: branchName, workspace },
          "Cloned and branched — running agent",
        );

        // Get authenticated Octokit for API calls
        const octokit = await app.auth(installationId);

        // Configure git user identity
        const { botUsername } = getConfig();
        await git.addConfig("user.name", botUsername);
        await git.addConfig("user.email", `${botUsername}@users.noreply.github.com`);

        // Fetch issue context and build prompt
        const issueContext = await fetchIssueContext(octokit, owner, repo, issueNumber);
        const agentPrompt = buildAgentPrompt(issueContext, prompt);

        // Run the coding agent
        const agentResult = await runAgent(agentPrompt, workspace);

        if (!agentResult.success) {
          await postErrorComment(
            octokit, owner, repo, issueNumber, sender,
            agentResult.error ?? "Agent failed with no error message",
          );
          return { success: false, summary: agentResult.error };
        }

        // Check if agent made any changes
        const status = await git.status();
        if (status.isClean()) {
          await postErrorComment(
            octokit, owner, repo, issueNumber, sender,
            "Agent completed but made no changes to the codebase.",
          );
          return { success: false, summary: "No changes made" };
        }

        // Commit and push
        await commitAndPush(git, `mollusk: address issue #${issueNumber}`);

        // Get default branch for PR base
        const { data: repoData } = await octokit.request(
          "GET /repos/{owner}/{repo}",
          { owner, repo },
        );

        // Create PR
        const prTitle = buildPRTitle(issueContext.title, issueNumber);
        const prBody = buildPRBody(issueNumber, agentResult.output ?? "");
        const { prUrl } = await createPullRequest({
          octokit,
          owner,
          repo,
          head: branchName,
          base: repoData.default_branch,
          title: prTitle,
          body: prBody,
          reviewer: sender,
        });

        // Notify the user
        await postCompletionComment(octokit, owner, repo, issueNumber, sender, prUrl);

        app.log.info({ jobId: job.id, prUrl }, "PR created successfully");
        return { success: true, summary: `PR created: ${prUrl}` };
      } catch (err) {
        app.log.error({ jobId: job.id, err }, "Job failed unexpectedly");

        try {
          const octokit = await app.auth(installationId);
          await postErrorComment(
            octokit, owner, repo, issueNumber, sender,
            err instanceof Error ? err.message : String(err),
          );
        } catch {
          app.log.error("Failed to post error comment");
        }

        return { success: false, summary: String(err) };
      } finally {
        if (workspace) {
          await cleanupWorkspace(workspace);
          app.log.info({ workspace }, "Cleaned up workspace");
        }
      }
    },
    {
      connection: getConnectionOptions(),
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    app.log.error(
      { jobId: job?.id, err },
      "Agent job failed",
    );
  });

  worker.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      app.log.warn("Redis not available — worker cannot process jobs");
    } else {
      app.log.error({ err }, "Worker error");
    }
  });

  return worker;
}
