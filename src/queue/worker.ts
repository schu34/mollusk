import { Worker } from "bullmq";
import { getConnectionOptions } from "./connection.js";
import type {
  AgentJobData,
  AgentJobResult,
  IssueJobData,
  PRReviewJobData,
} from "./jobs.js";
import { getApp } from "../app.js";
import { getInstallationToken } from "../github/auth.js";
import { createWorkspace, cleanupWorkspace } from "../git/workspace.js";
import {
  cloneRepo,
  createBranch,
  checkoutBranch,
  buildCloneUrl,
  generateBranchName,
  commitAndPush,
} from "../git/operations.js";
import { getConfig } from "../config.js";
import {
  fetchIssueContext,
  buildAgentPrompt,
  fetchPRReviewContext,
  buildPRReviewPrompt,
} from "../agent/context.js";
import { runAgent } from "../agent/runner.js";
import {
  postComment,
  postCompletionComment,
  postErrorComment,
} from "../github/comments.js";
import {
  createPullRequest,
  buildPRTitle,
  buildPRBody,
} from "../github/pulls.js";
type AppType = ReturnType<typeof getApp>;
type OctokitType = Awaited<ReturnType<AppType["auth"]>>;

async function processIssueJob(
  app: AppType,
  job: { id?: string; data: IssueJobData }
): Promise<AgentJobResult> {
  const { owner, repo, issueNumber, installationId, sender, prompt } = job.data;

  app.log.info(
    { jobId: job.id, data: job.data },
    "Processing issue job %s/%s#%d",
    owner,
    repo,
    issueNumber
  );

  let workspace: string | undefined;
  let octokit: OctokitType | undefined;
  let step = "";

  try {
    let shouldCleanupWorkspace = true;
    step = "fetching installation token";
    const token = await getInstallationToken(installationId);
    octokit = await app.auth(installationId);

    step = "creating workspace";
    workspace = await createWorkspace(owner, repo, issueNumber);

    step = "cloning repo";
    const cloneUrl = buildCloneUrl(owner, repo, token);
    const git = await cloneRepo(cloneUrl, workspace);
    const branchName = generateBranchName(issueNumber);
    await createBranch(git, branchName);

    step = "configuring git identity";
    const { botUsername } = getConfig();
    await git.addConfig("user.name", botUsername);
    await git.addConfig(
      "user.email",
      `${botUsername}@users.noreply.github.com`
    );

    step = "fetching issue context";
    const issueContext = await fetchIssueContext(
      octokit,
      owner,
      repo,
      issueNumber
    );

    step = "building agent prompt";
    const agentPrompt = buildAgentPrompt(issueContext, prompt);

    step = "running coding agent";
    app.log.info(
      { jobId: job.id },
      "Running coding agent (this may take a while)"
    );
    const agentResult = await runAgent(agentPrompt, workspace);
    app.log.info(
      { jobId: job.id, success: agentResult.success },
      "Agent finished"
    );

    if (!agentResult.success) {
      await postErrorComment(
        octokit,
        owner,
        repo,
        issueNumber,
        sender,
        agentResult.error ?? "Agent failed with no error message"
      );
      return { success: false, summary: agentResult.error };
    }

    step = "checking git status";
    const status = await git.status();
    if (status.isClean()) {
      shouldCleanupWorkspace = false; // keep workspace for debugging since agent made no changes
      await postErrorComment(
        octokit,
        owner,
        repo,
        issueNumber,
        sender,
        "Agent completed but made no changes to the codebase."
      );
      return { success: false, summary: "No changes made" };
    }

    step = "committing and pushing";
    await commitAndPush(git, `mollusk: address issue #${issueNumber}`);

    step = "creating pull request";
    const { data: repoData } = await octokit.request(
      "GET /repos/{owner}/{repo}",
      { owner, repo }
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

    step = "posting completion comment";
    await postCompletionComment(
      octokit,
      owner,
      repo,
      issueNumber,
      sender,
      prUrl
    );

    app.log.info({ jobId: job.id, prUrl }, "Job complete — PR created");
    return { success: true, summary: `PR created: ${prUrl}` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    app.log.error({ jobId: job.id, step, err }, "Job failed at step: %s", step);
    if (octokit) {
      try {
        await postErrorComment(
          octokit,
          owner,
          repo,
          issueNumber,
          sender,
          `Failed while ${step}: ${errorMsg}`
        );
      } catch (commentErr) {
        app.log.error(
          { jobId: job.id, commentErr },
          "Failed to post error comment"
        );
      }
    }
    return { success: false, summary: `Failed while ${step}: ${errorMsg}` };
  } finally {
    if (workspace) {
      if (shouldCleanupWorkspace) {
        try {
          await cleanupWorkspace(workspace);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function processPRReviewJob(
  app: AppType,
  job: { id?: string; data: PRReviewJobData }
): Promise<AgentJobResult> {
  const { owner, repo, prNumber, prBranch, installationId, sender, prompt } =
    job.data;

  app.log.info(
    { jobId: job.id, data: job.data },
    "Processing PR review job %s/%s#%d",
    owner,
    repo,
    prNumber
  );

  let workspace: string | undefined;
  let octokit: OctokitType | undefined;
  let step = "";

  try {
    step = "fetching installation token";
    const token = await getInstallationToken(installationId);
    octokit = await app.auth(installationId);

    step = "creating workspace";
    workspace = await createWorkspace(owner, repo, prNumber);

    step = "cloning repo and checking out PR branch";
    const cloneUrl = buildCloneUrl(owner, repo, token);
    const git = await cloneRepo(cloneUrl, workspace);
    await checkoutBranch(git, prBranch);

    step = "configuring git identity";
    const { botUsername } = getConfig();
    await git.addConfig("user.name", botUsername);
    await git.addConfig(
      "user.email",
      `${botUsername}@users.noreply.github.com`
    );

    step = "fetching PR review context";
    const reviewContext = await fetchPRReviewContext(
      octokit,
      owner,
      repo,
      prNumber
    );

    step = "building agent prompt";
    const agentPrompt = buildPRReviewPrompt(reviewContext, prompt);

    step = "running coding agent";
    app.log.info(
      { jobId: job.id },
      "Running coding agent for PR review (this may take a while)"
    );
    const agentResult = await runAgent(agentPrompt, workspace);
    app.log.info(
      { jobId: job.id, success: agentResult.success },
      "Agent finished"
    );

    if (!agentResult.success) {
      await postErrorComment(
        octokit,
        owner,
        repo,
        prNumber,
        sender,
        agentResult.error ?? "Agent failed with no error message"
      );
      return { success: false, summary: agentResult.error };
    }

    step = "checking git status";
    const status = await git.status();
    if (status.isClean()) {
      await postErrorComment(
        octokit,
        owner,
        repo,
        prNumber,
        sender,
        "Agent completed but made no changes to the codebase."
      );
      return { success: false, summary: "No changes made" };
    }

    step = "committing and pushing";
    await commitAndPush(
      git,
      `mollusk: address review feedback on PR #${prNumber}`
    );

    step = "posting completion comment";
    await postComment(
      octokit,
      owner,
      repo,
      prNumber,
      `@${sender} I've pushed changes addressing your review feedback.`
    );

    app.log.info(
      { jobId: job.id },
      "Job complete — pushed review fixes to PR #%d",
      prNumber
    );
    return { success: true, summary: `Pushed review fixes to PR #${prNumber}` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    app.log.error({ jobId: job.id, step, err }, "Job failed at step: %s", step);
    if (octokit) {
      try {
        await postErrorComment(
          octokit,
          owner,
          repo,
          prNumber,
          sender,
          `Failed while ${step}: ${errorMsg}`
        );
      } catch (commentErr) {
        app.log.error(
          { jobId: job.id, commentErr },
          "Failed to post error comment"
        );
      }
    }
    return { success: false, summary: `Failed while ${step}: ${errorMsg}` };
  } finally {
    if (workspace) {
      try {
        await cleanupWorkspace(workspace);
      } catch {
        /* ignore */
      }
    }
  }
}

export function startWorker(): Worker<AgentJobData, AgentJobResult> {
  const app = getApp();
  app.log.info("Starting worker to process agent jobs");
  const worker = new Worker<AgentJobData, AgentJobResult>(
    "agent-jobs",
    async (job) => {
      if (job.data.type === "pr_review") {
        return await processPRReviewJob(app, job as any);
      }
      return await processIssueJob(app, job as any);
    },
    {
      connection: getConnectionOptions(),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    app.log.error({ jobId: job?.id, err }, "Agent job failed");
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
