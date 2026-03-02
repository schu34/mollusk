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
} from "../git/operations.js";

export function startWorker(app: Probot): Worker<AgentJobData, AgentJobResult> {
  const worker = new Worker<AgentJobData, AgentJobResult>(
    "agent-jobs",
    async (job) => {
      const { owner, repo, issueNumber, installationId } = job.data;

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
          "Cloned and branched — ready for agent (Phase 4)",
        );

        // Phase 4: agent runner will go here

        return { success: true, summary: "cloned and branched" };
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
