import { Worker } from "bullmq";
import type { Probot } from "probot";
import { getConnectionOptions } from "./connection.js";
import type { AgentJobData, AgentJobResult } from "./jobs.js";

export function startWorker(app: Probot): Worker<AgentJobData, AgentJobResult> {
  const worker = new Worker<AgentJobData, AgentJobResult>(
    "agent-jobs",
    async (job) => {
      app.log.info(
        { jobId: job.id, data: job.data },
        "Processing agent job %s/%s#%d",
        job.data.owner,
        job.data.repo,
        job.data.issueNumber,
      );
      return { success: true, summary: "stub" };
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
