export interface ParsedMention {
  /** The prompt text after the @mention */
  prompt: string;
  /** GitHub login of the user who mentioned the bot */
  sender: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Issue or PR number */
  issueNumber: number;
}

/**
 * Parses a comment body for an @mention of the bot.
 * Returns a ParsedMention if the bot was mentioned, null otherwise.
 */
export function parseMention(
  body: string,
  botUsername: string,
  sender: string,
  owner: string,
  repo: string,
  issueNumber: number,
): ParsedMention | null {
  const mentionPattern = new RegExp(`@${escapeRegExp(botUsername)}\\b`, "i");
  const match = mentionPattern.exec(body);

  if (!match) return null;

  // Extract the prompt: everything after the @mention, trimmed
  const prompt = body.slice(match.index + match[0].length).trim();

  if (!prompt) return null;

  return { prompt, sender, owner, repo, issueNumber };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
