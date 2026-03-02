import { Queue } from "bullmq";
import { getConnectionOptions } from "./connection.js";
import type { AgentJobData, AgentJobResult } from "./jobs.js";

let agentQueue: Queue<AgentJobData, AgentJobResult> | null = null;

export function getAgentQueue(): Queue<AgentJobData, AgentJobResult> {
  if (agentQueue) return agentQueue;

  agentQueue = new Queue("agent-jobs", {
    connection: getConnectionOptions(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

  return agentQueue;
}
