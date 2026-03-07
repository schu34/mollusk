import { Worker } from "bullmq";
import { getConnectionOptions } from "./connection.js";
import type { AgentJobData, AgentJobResult } from "./jobs.js";
import { getApp } from "../app.js";
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

export function startWorker(): Worker<AgentJobData, AgentJobResult> {
  const app = getApp();
  app.log.info("Starting worker to process agent jobs");
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
      let octokit: Awaited<ReturnType<typeof app.auth>> | undefined;
      let step = "";

      try {
        // Step 1: Auth
        step = "fetching installation token";
        app.log.info({ jobId: job.id }, "[1/10] Fetching installation token");
        const token = await getInstallationToken(installationId);

        // Get authenticated Octokit early so error comments work in later catches
        octokit = await app.auth(installationId);

        // Step 2: Workspace
        step = "creating workspace";
        app.log.info({ jobId: job.id }, "[2/10] Creating workspace");
        workspace = await createWorkspace(owner, repo, issueNumber);

        // Step 3: Clone + branch
        step = "cloning repo";
        app.log.info({ jobId: job.id, workspace }, "[3/10] Cloning repo and creating branch");
        const cloneUrl = buildCloneUrl(owner, repo, token);
        const git = await cloneRepo(cloneUrl, workspace);
        const branchName = generateBranchName(issueNumber);
        await createBranch(git, branchName);
        app.log.info({ jobId: job.id, branch: branchName }, "Branch created");

        // Configure git user identity
        step = "configuring git identity";
        const { botUsername } = getConfig();
        await git.addConfig("user.name", botUsername);
        await git.addConfig("user.email", `${botUsername}@users.noreply.github.com`);

        // Step 4: Fetch issue context
        step = "fetching issue context";
        app.log.info({ jobId: job.id }, "[4/10] Fetching issue context");
        const issueContext = await fetchIssueContext(octokit, owner, repo, issueNumber);
        app.log.info(
          { jobId: job.id, title: issueContext.title, commentCount: issueContext.comments.length },
          "Issue context fetched",
        );

        // Step 5: Build prompt
        step = "building agent prompt";
        app.log.info({ jobId: job.id }, "[5/10] Building agent prompt");
        const agentPrompt = buildAgentPrompt(issueContext, prompt);
        app.log.debug({ jobId: job.id, promptLength: agentPrompt.length }, "Prompt built");

        // Step 6: Run agent
        step = "running coding agent";
        app.log.info({ jobId: job.id }, "[6/10] Running coding agent (this may take a while)");
        app.log.info(
          { jobId: job.id, logFile: `${workspace}/.mollusk-agent.log` },
          "Agent logs streaming to file — tail -f to follow",
        );
        const agentResult = await runAgent(agentPrompt, workspace);
        app.log.info(
          { jobId: job.id, success: agentResult.success, outputLength: agentResult.output?.length ?? 0, logFile: agentResult.logFile },
          "Agent finished",
        );

        if (!agentResult.success) {
          app.log.warn({ jobId: job.id, error: agentResult.error }, "Agent failed");
          await postErrorComment(
            octokit, owner, repo, issueNumber, sender,
            agentResult.error ?? "Agent failed with no error message",
          );
          return { success: false, summary: agentResult.error };
        }

        // Step 7: Check for changes
        step = "checking git status";
        app.log.info({ jobId: job.id }, "[7/10] Checking git status");
        const status = await git.status();
        if (status.isClean()) {
          app.log.warn({ jobId: job.id }, "No changes detected — nothing to commit");
          await postErrorComment(
            octokit, owner, repo, issueNumber, sender,
            "Agent completed but made no changes to the codebase.",
          );
          return { success: false, summary: "No changes made" };
        }
        app.log.info(
          { jobId: job.id, created: status.created, modified: status.modified, deleted: status.deleted },
          "Changes detected",
        );

        // Step 8: Commit + push
        step = "committing and pushing";
        app.log.info({ jobId: job.id }, "[8/10] Committing and pushing");
        await commitAndPush(git, `mollusk: address issue #${issueNumber}`);
        app.log.info({ jobId: job.id, branch: branchName }, "Pushed to remote");

        // Step 9: Create PR
        step = "creating pull request";
        app.log.info({ jobId: job.id }, "[9/10] Creating pull request");
        const { data: repoData } = await octokit.request(
          "GET /repos/{owner}/{repo}",
          { owner, repo },
        );
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

        // Step 10: Notify user
        step = "posting completion comment";
        app.log.info({ jobId: job.id }, "[10/10] Posting completion comment");
        await postCompletionComment(octokit, owner, repo, issueNumber, sender, prUrl);

        app.log.info({ jobId: job.id, prUrl }, "Job complete — PR created");
        return { success: true, summary: `PR created: ${prUrl}` };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        app.log.error({ jobId: job.id, step, err }, "Job failed at step: %s", step);

        if (octokit) {
          try {
            await postErrorComment(
              octokit, owner, repo, issueNumber, sender,
              `Failed while ${step}: ${errorMsg}`,
            );
          } catch (commentErr) {
            app.log.error({ jobId: job.id, commentErr }, "Failed to post error comment");
          }
        } else {
          app.log.error({ jobId: job.id }, "Cannot post error comment — no authenticated octokit");
        }

        return { success: false, summary: `Failed while ${step}: ${errorMsg}` };
      } finally {
        if (workspace) {
          try {
            await cleanupWorkspace(workspace);
            app.log.info({ workspace }, "Cleaned up workspace");
          } catch (cleanupErr) {
            app.log.error({ workspace, cleanupErr }, "Failed to clean up workspace");
          }
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
