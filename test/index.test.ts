import nock from "nock";
import { Probot, ProbotOctokit } from "probot";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, beforeEach, afterEach, test, expect, vi } from "vitest";

vi.mock("../src/queue/queues.js", () => {
  const mockAdd = vi.fn().mockResolvedValue({});
  return {
    getAgentQueue: vi.fn(() => ({ add: mockAdd })),
  };
});

vi.mock("../src/queue/worker.js", () => ({
  startWorker: vi.fn(),
}));

// Must import after mocks are declared
const { default: myProbotApp } = await import("../src/index.js");
const { getAgentQueue } = await import("../src/queue/queues.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8",
);

const issuesOpenedPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/issues.opened.json"), "utf-8"),
);

const issueCommentPayload = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/issue_comment.created.json"),
    "utf-8",
  ),
);

describe("mollusk", () => {
  let probot: any;

  beforeEach(() => {
    nock.disableNetConnect();
    process.env.BOT_USERNAME = "mollusk-bot";
    probot = new Probot({
      appId: 123,
      privateKey,
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });
    probot.load(myProbotApp);
  });

  test("creates a comment when an issue is opened", async () => {
    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test", permissions: { issues: "write" } })
      .post("/repos/hiimbex/testing-things/issues/1/comments", (body: any) => {
        expect(body).toMatchObject({ body: "Thanks for opening this issue!" });
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issues", payload: issuesOpenedPayload });
    expect(mock.pendingMocks()).toStrictEqual([]);
  });

  test("posts acknowledgment when bot is mentioned in issue comment", async () => {
    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, { token: "test", permissions: { issues: "write" } })
      .post("/repos/hiimbex/testing-things/issues/1/comments", (body: any) => {
        expect(body.body).toContain("@hiimbex");
        expect(body.body).toContain("I'm on it");
        return true;
      })
      .reply(200);

    await probot.receive({
      name: "issue_comment",
      payload: issueCommentPayload,
    });
    expect(mock.pendingMocks()).toStrictEqual([]);

    const mockAdd = getAgentQueue().add as ReturnType<typeof vi.fn>;
    expect(mockAdd).toHaveBeenCalledWith(
      "hiimbex/testing-things#1",
      {
        owner: "hiimbex",
        repo: "testing-things",
        issueNumber: 1,
        sender: "hiimbex",
        prompt: "please add a README file",
        installationId: 2,
      },
    );
  });

  test("ignores issue comments that do not mention the bot", async () => {
    const noMentionPayload = {
      ...issueCommentPayload,
      comment: { ...issueCommentPayload.comment, body: "just a regular comment" },
    };

    // No nock mocks — if it tries to call the API, nock will throw
    await probot.receive({
      name: "issue_comment",
      payload: noMentionPayload,
    });
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
    delete process.env.BOT_USERNAME;
  });
});
