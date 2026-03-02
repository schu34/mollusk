export interface AgentJobData {
  owner: string;
  repo: string;
  issueNumber: number;
  sender: string;
  prompt: string;
  installationId: number;
}

export interface AgentJobResult {
  success: boolean;
  summary?: string;
}
