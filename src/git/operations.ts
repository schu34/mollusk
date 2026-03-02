import { simpleGit, type SimpleGit } from "simple-git";
import crypto from "crypto";

export function buildCloneUrl(
  owner: string,
  repo: string,
  token: string,
): string {
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

export function generateBranchName(issueNumber: number): string {
  const random = crypto.randomBytes(3).toString("hex");
  return `mollusk/issue-${issueNumber}-${random}`;
}

export async function cloneRepo(
  repoUrl: string,
  workspacePath: string,
): Promise<SimpleGit> {
  const git = simpleGit();
  await git.clone(repoUrl, workspacePath);
  return simpleGit(workspacePath);
}

export async function createBranch(
  git: SimpleGit,
  branchName: string,
): Promise<void> {
  await git.checkoutLocalBranch(branchName);
}

export async function commitAndPush(
  git: SimpleGit,
  message: string,
): Promise<void> {
  await git.add("-A");
  await git.commit(message);
  const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
  await git.push("origin", branch);
}
