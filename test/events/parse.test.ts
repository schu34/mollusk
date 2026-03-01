import { describe, test, expect } from "vitest";
import { parseMention } from "../../src/events/parse.js";

const defaults = {
  sender: "hiimbex",
  owner: "hiimbex",
  repo: "testing-things",
  issueNumber: 1,
};

describe("parseMention", () => {
  test("detects a mention and extracts the prompt", () => {
    const result = parseMention(
      "@mollusk-bot please add a README file",
      "mollusk-bot",
      defaults.sender,
      defaults.owner,
      defaults.repo,
      defaults.issueNumber,
    );

    expect(result).not.toBeNull();
    expect(result!.prompt).toBe("please add a README file");
    expect(result!.sender).toBe("hiimbex");
    expect(result!.owner).toBe("hiimbex");
    expect(result!.repo).toBe("testing-things");
    expect(result!.issueNumber).toBe(1);
  });

  test("returns null when bot is not mentioned", () => {
    const result = parseMention(
      "this is just a normal comment",
      "mollusk-bot",
      defaults.sender,
      defaults.owner,
      defaults.repo,
      defaults.issueNumber,
    );

    expect(result).toBeNull();
  });

  test("returns null when mention has no prompt", () => {
    const result = parseMention(
      "@mollusk-bot",
      "mollusk-bot",
      defaults.sender,
      defaults.owner,
      defaults.repo,
      defaults.issueNumber,
    );

    expect(result).toBeNull();
  });

  test("is case-insensitive for the mention", () => {
    const result = parseMention(
      "@Mollusk-Bot fix the typo",
      "mollusk-bot",
      defaults.sender,
      defaults.owner,
      defaults.repo,
      defaults.issueNumber,
    );

    expect(result).not.toBeNull();
    expect(result!.prompt).toBe("fix the typo");
  });

  test("detects mention in the middle of a comment", () => {
    const result = parseMention(
      "Hey @mollusk-bot can you refactor this function",
      "mollusk-bot",
      defaults.sender,
      defaults.owner,
      defaults.repo,
      defaults.issueNumber,
    );

    expect(result).not.toBeNull();
    expect(result!.prompt).toBe("can you refactor this function");
  });

  test("does not match partial usernames", () => {
    const result = parseMention(
      "@mollusk-botster do something",
      "mollusk-bot",
      defaults.sender,
      defaults.owner,
      defaults.repo,
      defaults.issueNumber,
    );

    expect(result).toBeNull();
  });
});
