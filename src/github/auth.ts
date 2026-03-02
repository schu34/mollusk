import type { Probot } from "probot";

export async function getInstallationToken(
  app: Probot,
  installationId: number,
): Promise<string> {
  const octokit = await app.auth(installationId);
  const { token } = (await octokit.auth({ type: "installation" })) as {
    token: string;
  };
  return token;
}
