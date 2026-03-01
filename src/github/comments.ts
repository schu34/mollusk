import type { Context } from "probot";

export async function postAcknowledgment(
  context: Context<"issue_comment.created">,
  sender: string,
  prompt: string,
): Promise<void> {
  const truncatedPrompt =
    prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt;

  await context.octokit.issues.createComment(
    context.issue({
      body: `👋 @${sender} I'm on it! Working on:\n> ${truncatedPrompt}`,
    }),
  );
}
