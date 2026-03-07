import { getApp } from "../app.js";

export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const app = getApp();
  const octokit = await app.auth(installationId);
  const { token } = (await octokit.auth({ type: "installation" })) as {
    token: string;
  };
  return token;
}
