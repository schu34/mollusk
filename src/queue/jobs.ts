interface BaseJobData {
  owner: string;
  repo: string;
  sender: string;
  prompt: string;
  installationId: number;
}

export interface IssueJobData extends BaseJobData {
  type: "issue";
  issueNumber: number;
}

export interface PRReviewJobData extends BaseJobData {
  type: "pr_review";
  prNumber: number;
  prBranch: string;
}

export type AgentJobData = IssueJobData | PRReviewJobData;

export interface AgentJobResult {
  success: boolean;
  summary?: string;
}
